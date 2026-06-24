// Calendar sync runner — mirrors a connected calendar (Google, Outlook) into the
// CalendarEvent cache table, deduped so a re-sync UPDATEs an event instead of
// duplicating it, and bounded to a rolling window so the table stays small.
//
// Dedupe key: (provider, externalId) within a workspace. On a match we UPDATE
// the mutable display fields but NEVER touch `followUpDone` — that's the user's
// dismissal state and must survive re-syncs.
//
// planEventSync is pure (no DB) so the dedupe/window logic is unit-testable;
// runEventSync wraps it with the Prisma reads/writes + the prune.

import { prisma } from "@/lib/prisma";
import type { EventWindow, ImportedEvent, ProviderId } from "./types";

// How far back / forward we keep events. The past window powers follow-ups for
// recently-ended meetings; the future window powers meeting prep.
export const PAST_WINDOW_DAYS = 7;
export const FUTURE_WINDOW_DAYS = 30;

export function defaultWindow(now: Date = new Date()): EventWindow {
  return {
    timeMin: new Date(now.getTime() - PAST_WINDOW_DAYS * 86_400_000),
    timeMax: new Date(now.getTime() + FUTURE_WINDOW_DAYS * 86_400_000),
  };
}

export type EventFields = {
  title: string | null;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  organizer: string | null;
  attendees: string[];
  htmlLink: string | null;
};

export type EventSyncSummary = {
  received: number; // events the provider returned (after the connector's filtering)
  created: number; // new rows inserted
  updated: number; // existing rows refreshed
  pruned: number; // stale rows removed (outside the window or no longer present)
};

export type ExistingEvent = { id: string; externalId: string };

export type EventSyncPlan = {
  creates: Array<{ externalId: string; fields: EventFields }>;
  updates: Array<{ id: string; fields: EventFields }>;
  // ids of existing rows to delete: out of window, or gone from the provider.
  deletes: string[];
  summary: EventSyncSummary;
};

function toFields(e: ImportedEvent): EventFields {
  return {
    title: e.title ?? null,
    startsAt: e.startsAt,
    endsAt: e.endsAt ?? null,
    location: e.location ?? null,
    organizer: e.organizer ?? null,
    attendees: e.attendees ?? [],
    htmlLink: e.htmlLink ?? null,
  };
}

// Decide create/update/delete for the incoming event set against what's stored.
// Pure: no DB access. `existing` is every stored event for (workspace, provider).
export function planEventSync(
  incoming: ImportedEvent[],
  existing: ExistingEvent[]
): EventSyncPlan {
  const byExternal = new Map<string, ExistingEvent>();
  for (const e of existing) byExternal.set(e.externalId, e);

  const creates: Array<{ externalId: string; fields: EventFields }> = [];
  const updates: Array<{ id: string; fields: EventFields }> = [];
  const seen = new Set<string>();

  for (const e of incoming) {
    if (!e.externalId || seen.has(e.externalId)) continue;
    seen.add(e.externalId);
    const fields = toFields(e);
    const match = byExternal.get(e.externalId);
    if (match) updates.push({ id: match.id, fields });
    else creates.push({ externalId: e.externalId, fields });
  }

  // Anything stored that the provider no longer returns (cancelled, deleted, or
  // aged out of the window) is removed so the cache reflects the live calendar.
  const deletes = existing.filter((e) => !seen.has(e.externalId)).map((e) => e.id);

  return {
    creates,
    updates,
    deletes,
    summary: {
      received: seen.size,
      created: creates.length,
      updated: updates.length,
      pruned: deletes.length,
    },
  };
}

// Execute a calendar sync for one connection: read stored events, plan, apply.
export async function runEventSync(
  incoming: ImportedEvent[],
  provider: ProviderId,
  scope: { userId: string | null; workspaceId: string | null }
): Promise<EventSyncSummary> {
  const where = { provider, ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}) };
  const existing = (await prisma.calendarEvent.findMany({
    where,
    select: { id: true, externalId: true },
  })) as ExistingEvent[];

  const plan = planEventSync(incoming, existing);

  if (plan.creates.length) {
    await prisma.calendarEvent.createMany({
      data: plan.creates.map(({ externalId, fields }) => ({
        ...fields,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        provider,
        externalId,
      })) as never,
    });
  }

  for (const u of plan.updates) {
    // Only mutable display fields — followUpDone is intentionally untouched.
    await prisma.calendarEvent.update({ where: { id: u.id }, data: u.fields });
  }

  if (plan.deletes.length) {
    await prisma.calendarEvent.deleteMany({ where: { id: { in: plan.deletes } } });
  }

  return plan.summary;
}
