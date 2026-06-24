// Meeting intelligence — turns cached calendar events into actionable lists by
// matching event attendees to the contacts you already track.
//
//   • Meeting prep   — upcoming/ongoing meetings that include at least one known
//                      contact, so you can review them before you walk in.
//   • Follow-ups     — recently-ended meetings with a known contact that you
//                      haven't dismissed, so a relationship touch doesn't slip.
//
// A meeting with no matched contact is dropped: this app is about your network,
// and surfacing every personal/calendar-block event would just be noise.
//
// All logic here is PURE (no DB / no clock except the injected `now`) so it's
// unit-testable; the API route does the Prisma reads and passes data in.

export type MeetingContactInput = {
  id: string;
  name: string;
  email: string | null;
};

export type CalendarEventInput = {
  id: string;
  provider: string;
  title: string | null;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  attendees: string[]; // lowercased emails
  organizer: string | null; // lowercased email
  htmlLink: string | null;
  followUpDone: boolean;
};

export type MatchedContact = { id: string; name: string };

export type MeetingView = {
  id: string;
  provider: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string | null; // ISO
  location: string | null;
  htmlLink: string | null;
  matchedContacts: MatchedContact[];
  // Attendee emails with no matching contact — handy for "add this person".
  unknownAttendees: string[];
  followUpDone: boolean;
};

export type MeetingLists = {
  upcoming: MeetingView[]; // soonest first
  followUps: MeetingView[]; // most recently ended first
};

const UNTITLED = "(no title)";

function endOf(e: CalendarEventInput): Date {
  return e.endsAt ?? e.startsAt;
}

// Build the prep + follow-up lists. `contacts` is the full set for the
// workspace; `events` the cached calendar rows in the rolling window.
export function buildMeetings(
  events: CalendarEventInput[],
  contacts: MeetingContactInput[],
  now: Date = new Date()
): MeetingLists {
  // Index contacts by lowercased email for O(1) attendee lookup.
  const byEmail = new Map<string, MeetingContactInput>();
  for (const c of contacts) {
    const email = c.email?.trim().toLowerCase();
    if (email) byEmail.set(email, c);
  }

  const upcoming: MeetingView[] = [];
  const followUps: MeetingView[] = [];

  for (const e of events) {
    // Match organizer + attendees against known contacts (dedup by contact id).
    const matched = new Map<string, MatchedContact>();
    const unknown: string[] = [];
    const emails = [...(e.organizer ? [e.organizer] : []), ...e.attendees];
    for (const email of emails) {
      const c = byEmail.get(email);
      if (c) matched.set(c.id, { id: c.id, name: c.name });
      else if (!unknown.includes(email)) unknown.push(email);
    }
    if (matched.size === 0) continue; // no one we know → skip

    const view: MeetingView = {
      id: e.id,
      provider: e.provider,
      title: e.title?.trim() || UNTITLED,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt ? e.endsAt.toISOString() : null,
      location: e.location,
      htmlLink: e.htmlLink,
      matchedContacts: [...matched.values()],
      unknownAttendees: unknown,
      followUpDone: e.followUpDone,
    };

    if (endOf(e) >= now) {
      // Upcoming or in progress.
      upcoming.push(view);
    } else if (!e.followUpDone) {
      // Already ended and not yet dismissed → a follow-up candidate.
      followUps.push(view);
    }
  }

  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt)); // soonest first
  // Most recently ended first (compare on end, falling back to start).
  followUps.sort((a, b) => (b.endsAt ?? b.startsAt).localeCompare(a.endsAt ?? a.startsAt));

  return { upcoming, followUps };
}
