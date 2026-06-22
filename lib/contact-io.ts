// CSV + vCard import/export for contacts (Phase 3 — the first, lowest-friction
// "integration"). Pure and framework-free so it's unit-testable and usable from
// both the API and client. Round-trips standard fields; any non-standard CSV
// column becomes a customField, and customFields export as their own columns.

import type { Contact, ContactInput } from "./types";

// Standard scalar fields, in export column order.
const STANDARD_FIELDS = [
  "name",
  "email",
  "phone",
  "company",
  "title",
  "location",
  "tags",
  "birthday",
  "howWeMet",
] as const;

// Header label <-> field key. Import matching is case-insensitive and also
// accepts a few common aliases from other tools.
const HEADER_ALIASES: Record<string, (typeof STANDARD_FIELDS)[number]> = {
  name: "name",
  "full name": "name",
  "first name": "name", // best-effort; combined below if both present
  email: "email",
  "email address": "email",
  "e-mail": "email",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  company: "company",
  organization: "company",
  organisation: "company",
  title: "title",
  "job title": "title",
  role: "title",
  position: "title", // LinkedIn connections export uses "Position" for job title
  location: "location",
  city: "location",
  address: "location",
  tags: "tags",
  labels: "tags",
  birthday: "birthday",
  birthdate: "birthday",
  bday: "birthday",
  howwemet: "howWeMet",
  "how we met": "howWeMet",
  notes: "howWeMet",
};

// ─── CSV ────────────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function contactsToCsv(contacts: Contact[]): string {
  // Union of all custom-field keys across the set, sorted for stable output.
  const customKeys = new Set<string>();
  for (const c of contacts) {
    if (c.customFields) for (const k of Object.keys(c.customFields)) customKeys.add(k);
  }
  const customCols = [...customKeys].sort((a, b) => a.localeCompare(b));
  const header = [...STANDARD_FIELDS, ...customCols];

  const lines = [header.map(csvEscape).join(",")];
  for (const c of contacts) {
    const row = [
      ...STANDARD_FIELDS.map((f) => (c[f] == null ? "" : String(c[f]))),
      ...customCols.map((k) => c.customFields?.[k] ?? ""),
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

// Parse CSV text into an array of row objects keyed by the header. Handles
// quoted fields, embedded commas/newlines, and "" escaped quotes.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // End of line; swallow \r\n as one break and skip blank lines.
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Flush the last field/row (file may not end with a newline).
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((c) => c !== "")) rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

// Map parsed CSV rows to ContactInputs. Recognized headers fill standard fields;
// any other non-empty column becomes a custom field. Rows with no usable name
// are dropped (a name is required).
export function csvRowsToContactInputs(rows: Record<string, string>[]): ContactInput[] {
  const out: ContactInput[] = [];
  for (const raw of rows) {
    const input: ContactInput = { name: "" };
    const customFields: Record<string, string> = {};
    let firstName = "";
    let lastName = "";

    for (const [key, value] of Object.entries(raw)) {
      const v = value?.trim();
      if (!v) continue;
      const norm = key.trim().toLowerCase();
      const field = HEADER_ALIASES[norm];
      if (norm === "first name") {
        firstName = v;
        continue;
      }
      if (norm === "last name" || norm === "surname") {
        lastName = v;
        continue;
      }
      if (field) {
        // Don't clobber an already-set field (e.g. two aliases map to one key).
        if (!input[field]) input[field] = v;
      } else {
        customFields[key.trim()] = v;
      }
    }

    if (!input.name && (firstName || lastName)) {
      input.name = [firstName, lastName].filter(Boolean).join(" ");
    }
    if (!input.name) continue; // name is required
    if (Object.keys(customFields).length) input.customFields = customFields;
    out.push(input);
  }
  return out;
}

// ─── vCard (3.0) ──────────────────────────────────────────────────────────────

function vcardEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function vcardUnescape(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

export function contactsToVcf(contacts: Contact[]): string {
  const cards = contacts.map((c) => {
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vcardEscape(c.name)}`, `N:${vcardEscape(c.name)};;;;`];
    if (c.email) lines.push(`EMAIL:${vcardEscape(c.email)}`);
    if (c.phone) lines.push(`TEL:${vcardEscape(c.phone)}`);
    if (c.company || c.title) {
      if (c.company) lines.push(`ORG:${vcardEscape(c.company)}`);
      if (c.title) lines.push(`TITLE:${vcardEscape(c.title)}`);
    }
    if (c.location) lines.push(`ADR:;;${vcardEscape(c.location)};;;;`);
    // vCard BDAY wants YYYY-MM-DD; our "--MM-DD" (year unknown) is also valid vCard 4 but
    // tolerated widely — emit as-is.
    if (c.birthday) lines.push(`BDAY:${c.birthday}`);
    const noteParts: string[] = [];
    if (c.howWeMet) noteParts.push(`How we met: ${c.howWeMet}`);
    if (c.tags) noteParts.push(`Tags: ${c.tags}`);
    if (c.customFields) for (const [k, v] of Object.entries(c.customFields)) noteParts.push(`${k}: ${v}`);
    if (noteParts.length) lines.push(`NOTE:${vcardEscape(noteParts.join("\n"))}`);
    lines.push("END:VCARD");
    return lines.join("\r\n");
  });
  return cards.join("\r\n");
}

// Parse vCard text (one or many cards) into ContactInputs. Handles line folding
// (continuation lines starting with space/tab) and TYPE params on properties.
export function parseVcf(text: string): ContactInput[] {
  // Unfold folded lines first.
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const out: ContactInput[] = [];
  let current: ContactInput | null = null;

  for (const rawLine of unfolded.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      current = { name: "" };
      continue;
    }
    if (upper === "END:VCARD") {
      if (current && current.name) out.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const rawKey = line.slice(0, colon);
    const value = vcardUnescape(line.slice(colon + 1).trim());
    if (!value) continue;
    const prop = rawKey.split(";")[0].toUpperCase().replace(/^ITEM\d+\./, "");

    switch (prop) {
      case "FN":
        if (!current.name) current.name = value;
        break;
      case "N":
        if (!current.name) {
          // N = Family;Given;Additional;Prefix;Suffix
          const [family = "", given = ""] = value.split(";");
          const composed = [given, family].filter(Boolean).join(" ").trim();
          if (composed) current.name = composed;
        }
        break;
      case "EMAIL":
        if (!current.email) current.email = value;
        break;
      case "TEL":
        if (!current.phone) current.phone = value;
        break;
      case "ORG":
        if (!current.company) current.company = value.split(";")[0].trim();
        break;
      case "TITLE":
        if (!current.title) current.title = value;
        break;
      case "ADR":
        if (!current.location) {
          // ADR = pobox;ext;street;locality;region;postal;country — prefer locality.
          const parts = value.split(";");
          current.location = (parts[3] || parts[2] || parts.filter(Boolean)[0] || "").trim() || undefined;
        }
        break;
      case "BDAY":
        if (!current.birthday) current.birthday = value;
        break;
      case "NOTE":
        if (!current.howWeMet) current.howWeMet = value;
        break;
    }
  }
  return out;
}

// Sniff the format from a filename or content. Defaults to csv.
export function detectFormat(filename: string, content: string): "vcf" | "csv" {
  if (/\.vcf$/i.test(filename) || /BEGIN:VCARD/i.test(content)) return "vcf";
  return "csv";
}

export function parseContactsFile(filename: string, content: string): ContactInput[] {
  return detectFormat(filename, content) === "vcf"
    ? parseVcf(content)
    : csvRowsToContactInputs(parseCsv(content));
}
