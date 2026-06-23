// Sync runner — turns contacts pulled from a provider into rows in our Contact
// table, without creating duplicates on a re-sync. Shared by every connector.
//
// Dedupe precedence (per workspace):
//   1. (source, externalId) match  -> UPDATE that row (the provider is the
//      source of truth for contacts it owns; re-sync refreshes their fields).
//   2. name + email match          -> SKIP. The contact already exists from
//      another origin (manual entry, CSV, a different CRM). We do NOT overwrite
//      it or steal ownership — surfaced as a "duplicate" in the summary.
//   3. otherwise                   -> CREATE, stamped with source + externalId.
//
// planSync is pure (no DB) so the dedupe logic is unit-testable; runSync wraps
// it with the actual Prisma reads/writes.

import { prisma } from "@/lib/prisma";
import { validateContact } from "@/lib/validation";
import type { ImportedContact, ProviderId } from "./types";

export type SyncSummary = {
  received: number; // contacts the provider returned
  created: number; // new rows inserted
  updated: number; // existing synced rows refreshed
  duplicates: number; // matched an existing non-synced contact -> left untouched
  invalid: number; // failed validation or had no usable name
};

// The fields we write for a synced contact (shared by create + update).
type ContactFields = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  location: string | null;
  tags: string | null;
  birthday: string | null;
  howWeMet: string | null;
  customFields: string | null; // JSON string, matching the rest of the schema
};

export type ExistingContact = {
  id: string;
  name: string;
  email: string | null;
  source: string | null;
  externalId: string | null;
};

export type SyncPlan = {
  creates: Array<{ externalId: string; fields: ContactFields }>;
  updates: Array<{ id: string; fields: ContactFields }>;
  summary: SyncSummary;
};

// Dedupe key for the name+email fallback (case-insensitive), matching the CSV
// import route so the two paths agree on what "the same contact" means.
function keyOf(name: string, email: string | null): string {
  return `${name.trim().toLowerCase()}|${(email ?? "").trim().toLowerCase()}`;
}

function toFields(c: ImportedContact): ContactFields | null {
  const valid = validateContact(c);
  if (!valid.ok || !valid.data.name) return null;
  const d = valid.data;
  return {
    name: d.name!,
    email: d.email ?? null,
    phone: d.phone ?? null,
    company: d.company ?? null,
    title: d.title ?? null,
    location: d.location ?? null,
    tags: d.tags ?? null,
    birthday: d.birthday ?? null,
    howWeMet: d.howWeMet ?? null,
    customFields: d.customFields ? JSON.stringify(d.customFields) : null,
  };
}

// Decide create/update/skip for every incoming contact. Pure: no DB access.
export function planSync(
  incoming: ImportedContact[],
  existing: ExistingContact[],
  provider: ProviderId
): SyncPlan {
  // Index existing rows two ways.
  const byExternal = new Map<string, ExistingContact>(); // `${source}|${externalId}`
  const byNameEmail = new Map<string, ExistingContact>();
  for (const e of existing) {
    if (e.source && e.externalId) byExternal.set(`${e.source}|${e.externalId}`, e);
    byNameEmail.set(keyOf(e.name, e.email), e);
  }

  const creates: Array<{ externalId: string; fields: ContactFields }> = [];
  const updates: Array<{ id: string; fields: ContactFields }> = [];
  let invalid = 0;
  let duplicates = 0;

  // Guard against the provider returning the same externalId twice in one pull.
  const seenExternal = new Set<string>();

  for (const c of incoming) {
    if (!c.externalId || seenExternal.has(c.externalId)) {
      if (c.externalId) duplicates++;
      else invalid++;
      continue;
    }
    const fields = toFields(c);
    if (!fields) {
      invalid++;
      continue;
    }
    seenExternal.add(c.externalId);

    const extKey = `${provider}|${c.externalId}`;
    const existingByExt = byExternal.get(extKey);
    if (existingByExt) {
      updates.push({ id: existingByExt.id, fields });
      continue;
    }

    // Not previously synced from this provider — is it the same person we
    // already know from elsewhere? If so, leave the existing record alone.
    if (byNameEmail.has(keyOf(fields.name, fields.email))) {
      duplicates++;
      continue;
    }

    creates.push({ externalId: c.externalId, fields });
  }

  return {
    creates,
    updates,
    summary: {
      received: incoming.length,
      created: creates.length,
      updated: updates.length,
      duplicates,
      invalid,
    },
  };
}

// Execute a sync: read existing contacts for the workspace, plan, then apply.
export async function runSync(
  incoming: ImportedContact[],
  provider: ProviderId,
  scope: { userId: string | null; workspaceId: string | null }
): Promise<SyncSummary> {
  const where = scope.workspaceId ? { workspaceId: scope.workspaceId } : {};
  const existing = (await prisma.contact.findMany({
    where,
    select: { id: true, name: true, email: true, source: true, externalId: true },
  })) as ExistingContact[];

  const plan = planSync(incoming, existing, provider);

  if (plan.creates.length) {
    await prisma.contact.createMany({
      data: plan.creates.map(({ externalId, fields }) => ({
        ...fields,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        source: provider,
        externalId,
      })) as never,
    });
  }

  // Updates are per-row (createMany can't update). Synced contacts are
  // provider-owned, so refreshing their standard fields is intended.
  for (const u of plan.updates) {
    await prisma.contact.update({ where: { id: u.id }, data: u.fields });
  }

  return plan.summary;
}
