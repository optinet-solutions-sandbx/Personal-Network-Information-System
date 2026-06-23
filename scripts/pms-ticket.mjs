#!/usr/bin/env node
// Create a PMS ticket from the command line.
//
// Auth + targets come from .env (PMS_API_URL, PMS_API_TOKEN, PMS_PROJECT_ID,
// PMS_DONE_COLUMN_ID, PMS_ASSIGNEE_ID). Run with Node's --env-file so they load:
//
//   node --env-file=.env scripts/pms-ticket.mjs --title "..." --desc-file body.txt
//
// Flags:
//   --title "<text>"        (required) task title, <=200 chars
//   --desc  "<text>"        inline description (<=5000 chars)
//   --desc-file <path>      read description from a file (overrides --desc)
//   --column "<name|id>"    target column; defaults to PMS_DONE_COLUMN_ID ("Done")
//   --assignee "<id>"       assignee user id; defaults to PMS_ASSIGNEE_ID
//   --priority LOW|MEDIUM|HIGH|URGENT   (default MEDIUM)
//   --due <YYYY-MM-DD>      date stamped on the ticket; defaults to today (UTC)
//   --no-due                skip stamping a date
//   --dry-run               print the payload without posting
//
// Description may also be piped on stdin when neither --desc nor --desc-file is given.

import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key === "dry-run" || key === "no-due") out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function die(msg) {
  console.error(`pms-ticket: ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

const base = process.env.PMS_API_URL;
const token = process.env.PMS_API_TOKEN;
const projectId = process.env.PMS_PROJECT_ID;
if (!base || !token || !projectId) {
  die("missing PMS_API_URL / PMS_API_TOKEN / PMS_PROJECT_ID (load .env via `node --env-file=.env`).");
}

const title = args.title;
if (!title) die("--title is required.");
if (title.length > 200) die("--title exceeds 200 chars.");

let description = "";
if (args["desc-file"]) description = readFileSync(args["desc-file"], "utf8");
else if (args.desc != null) description = args.desc;
else if (!process.stdin.isTTY) description = readFileSync(0, "utf8"); // piped stdin
description = description.trim();
if (description.length > 5000) die("description exceeds 5000 chars.");

const assigneeId = args.assignee || process.env.PMS_ASSIGNEE_ID;
const priority = (args.priority || "MEDIUM").toUpperCase();

// Date stamped on the ticket so the PMS board keeps a trackable date. Defaults
// to today (midnight UTC); pass --due YYYY-MM-DD to override, or --no-due to skip.
function resolveDueDate() {
  if (args["no-due"]) return null;
  const raw = args.due;
  if (raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (!m) die("--due must be YYYY-MM-DD.");
    return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
  }
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
const dueDate = resolveDueDate();

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (res.status === 401) die("401 Unauthorized — the API token is invalid or expired. Regenerate it in PMS (Settings → API tokens) and update PMS_API_TOKEN in .env.");
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) die(`${path} → ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

// Resolve column: explicit id wins; otherwise match the requested name (or the
// default Done column id from env) against the project's live column list.
async function resolveColumnId() {
  const requested = args.column;
  if (!requested && process.env.PMS_DONE_COLUMN_ID) return process.env.PMS_DONE_COLUMN_ID;
  const columns = await api(`/api/projects/${projectId}/columns`);
  if (requested) {
    const byId = columns.find((c) => c.id === requested);
    if (byId) return byId.id;
    const byName = columns.find((c) => c.name.toLowerCase() === requested.toLowerCase());
    if (byName) return byName.id;
    die(`column "${requested}" not found. Available: ${columns.map((c) => c.name).join(", ")}`);
  }
  const done = columns.find((c) => c.name.toLowerCase() === "done");
  if (!done) die(`no "Done" column found. Available: ${columns.map((c) => c.name).join(", ")}`);
  return done.id;
}

const columnId = await resolveColumnId();

const payload = {
  title,
  columnId,
  priority,
  ...(description ? { description } : {}),
  ...(assigneeId ? { assigneeIds: [assigneeId] } : {}),
};

if (args["dry-run"]) {
  console.log(JSON.stringify({ ...payload, ...(dueDate ? { dueDate } : {}) }, null, 2));
  process.exit(0);
}

const task = await api(`/api/projects/${projectId}/tasks`, {
  method: "POST",
  body: JSON.stringify(payload),
});

const id = task?.id || task?.task?.id || "?";

// Stamp the date as a follow-up PATCH (the create endpoint doesn't take dueDate;
// the update endpoint does). Best-effort: the ticket is already created, so a
// failure here must NOT fail the whole command — just warn.
// NB: use a raw fetch here, not api() — api() calls process.exit on a non-ok
// response, which a try/catch can't intercept and would abort after the ticket
// already exists.
let dated = false;
if (dueDate && id !== "?") {
  try {
    const res = await fetch(`${base}/api/tasks/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ dueDate }),
    });
    if (res.ok) dated = true;
    else console.error(`  ⚠ could not stamp date (ticket still created): ${res.status}`);
  } catch (err) {
    console.error(`  ⚠ could not stamp date (ticket still created): ${err.message ?? err}`);
  }
}

console.log(`✓ Created PMS ticket ${id}: "${title}" → column ${columnId}${dated ? ` (dated ${dueDate.slice(0, 10)})` : ""}`);
console.log(`  ${base}/projects/${projectId}?task=${id}`);
