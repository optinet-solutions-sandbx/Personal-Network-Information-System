import { describe, it, expect } from "vitest";
import { buildMeetings, type CalendarEventInput, type MeetingContactInput } from "@/lib/meetings";

const NOW = new Date("2026-07-01T12:00:00Z");

const contacts: MeetingContactInput[] = [
  { id: "c1", name: "Ada Lovelace", email: "ada@x.com" },
  { id: "c2", name: "Grace Hopper", email: "Grace@Y.com" }, // mixed case on purpose
  { id: "c3", name: "No Email", email: null },
];

function evt(over: Partial<CalendarEventInput>): CalendarEventInput {
  return {
    id: "e",
    provider: "google",
    title: "Meeting",
    startsAt: new Date("2026-07-02T10:00:00Z"),
    endsAt: new Date("2026-07-02T11:00:00Z"),
    location: null,
    attendees: [],
    organizer: null,
    htmlLink: null,
    followUpDone: false,
    ...over,
  };
}

describe("buildMeetings", () => {
  it("matches attendees to contacts case-insensitively and lists unknowns", () => {
    const { upcoming } = buildMeetings(
      [evt({ id: "e1", attendees: ["ada@x.com", "grace@y.com", "stranger@z.com"] })],
      contacts,
      NOW
    );
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].matchedContacts.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(upcoming[0].unknownAttendees).toEqual(["stranger@z.com"]);
  });

  it("matches the organizer too", () => {
    const { upcoming } = buildMeetings(
      [evt({ id: "e1", organizer: "ada@x.com", attendees: [] })],
      contacts,
      NOW
    );
    expect(upcoming[0].matchedContacts.map((c) => c.id)).toEqual(["c1"]);
  });

  it("keeps an upcoming meeting with no known contact out of prep, in otherUpcoming", () => {
    const lists = buildMeetings([evt({ id: "e1", attendees: ["stranger@z.com"] })], contacts, NOW);
    expect(lists.upcoming).toHaveLength(0);
    expect(lists.followUps).toHaveLength(0);
    expect(lists.otherUpcoming.map((m) => m.id)).toEqual(["e1"]);
    expect(lists.otherUpcoming[0].unknownAttendees).toEqual(["stranger@z.com"]);
  });

  it("surfaces a solo upcoming event (no attendees) in otherUpcoming", () => {
    // A personal/recurring block: organizer is the user (not a contact), no attendees.
    const lists = buildMeetings(
      [evt({ id: "solo", title: "AI Engineer Fun Connect", organizer: "me@self.com", attendees: [] })],
      contacts,
      NOW
    );
    expect(lists.upcoming).toHaveLength(0);
    expect(lists.otherUpcoming.map((m) => m.id)).toEqual(["solo"]);
  });

  it("drops PAST meetings with no known contact (noise)", () => {
    const past = evt({
      id: "past-unknown",
      attendees: ["stranger@z.com"],
      startsAt: new Date("2026-06-30T10:00:00Z"),
      endsAt: new Date("2026-06-30T11:00:00Z"),
    });
    const lists = buildMeetings([past], contacts, NOW);
    expect(lists.upcoming).toHaveLength(0);
    expect(lists.followUps).toHaveLength(0);
    expect(lists.otherUpcoming).toHaveLength(0);
  });

  it("sorts otherUpcoming soonest-first", () => {
    const events = [
      evt({ id: "o-later", attendees: ["x@z.com"], startsAt: new Date("2026-07-05T10:00:00Z"), endsAt: new Date("2026-07-05T11:00:00Z") }),
      evt({ id: "o-sooner", attendees: ["x@z.com"], startsAt: new Date("2026-07-02T10:00:00Z"), endsAt: new Date("2026-07-02T11:00:00Z") }),
    ];
    const lists = buildMeetings(events, contacts, NOW);
    expect(lists.otherUpcoming.map((m) => m.id)).toEqual(["o-sooner", "o-later"]);
  });

  it("splits upcoming vs ended into prep vs follow-ups", () => {
    const future = evt({ id: "future", attendees: ["ada@x.com"], startsAt: new Date("2026-07-03T10:00:00Z"), endsAt: new Date("2026-07-03T11:00:00Z") });
    const past = evt({ id: "past", attendees: ["ada@x.com"], startsAt: new Date("2026-06-30T10:00:00Z"), endsAt: new Date("2026-06-30T11:00:00Z") });
    const lists = buildMeetings([future, past], contacts, NOW);
    expect(lists.upcoming.map((m) => m.id)).toEqual(["future"]);
    expect(lists.followUps.map((m) => m.id)).toEqual(["past"]);
  });

  it("treats an in-progress meeting (started, not ended) as upcoming", () => {
    const ongoing = evt({ id: "ongoing", attendees: ["ada@x.com"], startsAt: new Date("2026-07-01T11:30:00Z"), endsAt: new Date("2026-07-01T12:30:00Z") });
    const lists = buildMeetings([ongoing], contacts, NOW);
    expect(lists.upcoming.map((m) => m.id)).toEqual(["ongoing"]);
    expect(lists.followUps).toHaveLength(0);
  });

  it("excludes already-dismissed follow-ups", () => {
    const past = evt({ id: "past", attendees: ["ada@x.com"], startsAt: new Date("2026-06-30T10:00:00Z"), endsAt: new Date("2026-06-30T11:00:00Z"), followUpDone: true });
    expect(buildMeetings([past], contacts, NOW).followUps).toHaveLength(0);
  });

  it("sorts upcoming soonest-first and follow-ups most-recent-first", () => {
    const events = [
      evt({ id: "u-later", attendees: ["ada@x.com"], startsAt: new Date("2026-07-05T10:00:00Z"), endsAt: new Date("2026-07-05T11:00:00Z") }),
      evt({ id: "u-sooner", attendees: ["ada@x.com"], startsAt: new Date("2026-07-02T10:00:00Z"), endsAt: new Date("2026-07-02T11:00:00Z") }),
      evt({ id: "f-older", attendees: ["ada@x.com"], startsAt: new Date("2026-06-25T10:00:00Z"), endsAt: new Date("2026-06-25T11:00:00Z") }),
      evt({ id: "f-newer", attendees: ["ada@x.com"], startsAt: new Date("2026-06-29T10:00:00Z"), endsAt: new Date("2026-06-29T11:00:00Z") }),
    ];
    const lists = buildMeetings(events, contacts, NOW);
    expect(lists.upcoming.map((m) => m.id)).toEqual(["u-sooner", "u-later"]);
    expect(lists.followUps.map((m) => m.id)).toEqual(["f-newer", "f-older"]);
  });
});
