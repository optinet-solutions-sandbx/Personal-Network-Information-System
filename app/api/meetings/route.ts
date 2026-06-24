import { NextResponse } from "next/server";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildMeetings, type CalendarEventInput } from "@/lib/meetings";
import { defaultWindow } from "@/lib/connectors/calendar-sync";

export const dynamic = "force-dynamic";

// GET /api/meetings
// Meeting prep + follow-ups: cached calendar events in the rolling window,
// matched against the workspace's contacts by attendee email. Tokens/events are
// never exposed raw — only the matched, display-ready lists.
export async function GET() {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const where = ownerWhere(owner.workspaceId);
  const { timeMin } = defaultWindow();

  // Degrade gracefully if the CalendarEvent table hasn't been migrated yet
  // (shared-DB / additive-migration pattern): show "no meetings" rather than 500.
  const events = await prisma.calendarEvent
    .findMany({
      where: { ...where, startsAt: { gte: timeMin } },
      orderBy: { startsAt: "asc" },
    })
    .catch((err) => {
      console.error("GET /api/meetings: could not read calendar events:", err);
      return [] as Awaited<ReturnType<typeof prisma.calendarEvent.findMany>>;
    });

  // Whether a calendar-capable provider is connected — drives the empty state
  // ("connect a calendar" vs. "no upcoming meetings").
  const calendarConnected = await prisma.connection
    .count({ where: { ...where, provider: { in: ["google", "outlook"] } } })
    .then((n) => n > 0)
    .catch(() => false);

  const contacts = await prisma.contact.findMany({
    where,
    select: { id: true, name: true, email: true },
  });

  const eventInputs: CalendarEventInput[] = events.map((e) => ({
    id: e.id,
    provider: e.provider,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    location: e.location,
    attendees: e.attendees,
    organizer: e.organizer,
    htmlLink: e.htmlLink,
    followUpDone: e.followUpDone,
  }));

  const lists = buildMeetings(eventInputs, contacts);
  return NextResponse.json({ calendarConnected, ...lists });
}
