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
      if (key === "dry-run") out[key] = true;
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
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const task = await api(`/api/projects/${projectId}/tasks`, {
  method: "POST",
  body: JSON.stringify(payload),
});

const id = task?.id || task?.task?.id || "?";
console.log(`✓ Created PMS ticket ${id}: "${title}" → column ${columnId}`);
console.log(`  ${base}/projects/${projectId}?task=${id}`);
