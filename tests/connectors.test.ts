import { describe, it, expect } from "vitest";
import { __test as hubspot } from "@/lib/connectors/hubspot";
import { __test as google } from "@/lib/connectors/google";
import { __test as salesforce } from "@/lib/connectors/salesforce";
import { __test as outlook } from "@/lib/connectors/outlook";
import { planSync, type ExistingContact } from "@/lib/connectors/sync";
import { planEventSync, type ExistingEvent } from "@/lib/connectors/calendar-sync";
import type { ImportedContact, ImportedEvent } from "@/lib/connectors/types";

describe("HubSpot contact mapping", () => {
  it("composes first+last name and maps jobtitle/city/state", () => {
    const mapped = hubspot.toImportedContact({
      id: "501",
      properties: {
        firstname: "Ada",
        lastname: "Lovelace",
        email: "ada@analytical.engine",
        phone: "+1 555 0100",
        company: "Analytical Engines",
        jobtitle: "Mathematician",
        city: "London",
        state: "England",
        country: "UK",
      },
    });
    expect(mapped).toEqual({
      externalId: "501",
      name: "Ada Lovelace",
      email: "ada@analytical.engine",
      phone: "+1 555 0100",
      company: "Analytical Engines",
      title: "Mathematician",
      location: "London, England, UK",
    });
  });

  it("falls back to the email local-part when there's no name", () => {
    const mapped = hubspot.toImportedContact({
      id: "7",
      properties: { email: "grace@navy.mil" },
    });
    expect(mapped?.name).toBe("grace");
  });

  it("skips a record with neither name nor email", () => {
    expect(hubspot.toImportedContact({ id: "8", properties: {} })).toBeNull();
  });
});

describe("Google Contacts mapping", () => {
  it("maps People API fields and uses resourceName as the externalId", () => {
    const mapped = google.toImportedContact({
      resourceName: "people/c123",
      names: [{ displayName: "Katherine Johnson" }],
      emailAddresses: [{ value: "katherine@nasa.gov" }],
      phoneNumbers: [{ value: "+1 555 0188" }],
      organizations: [{ name: "NASA", title: "Mathematician" }],
      addresses: [{ city: "Hampton" }],
    });
    expect(mapped).toEqual({
      externalId: "people/c123",
      name: "Katherine Johnson",
      email: "katherine@nasa.gov",
      phone: "+1 555 0188",
      company: "NASA",
      title: "Mathematician",
      location: "Hampton",
    });
  });

  it("falls back to the email when there's no name, and skips when neither exists", () => {
    expect(
      google.toImportedContact({ resourceName: "people/c9", emailAddresses: [{ value: "x@y.com" }] })?.name
    ).toBe("x@y.com");
    expect(google.toImportedContact({ resourceName: "people/c0" })).toBeNull();
  });
});

describe("Salesforce mapping", () => {
  it("maps a Contact record, joins mailing address, reads Account.Name, uses Id as externalId", () => {
    const mapped = salesforce.toImportedContact({
      Id: "003xx0001",
      Name: "Margaret Hamilton",
      FirstName: "Margaret",
      LastName: "Hamilton",
      Email: "margaret@mit.edu",
      Phone: "+1 555 0142",
      Title: "Director of Software Engineering",
      MailingCity: "Cambridge",
      MailingState: "MA",
      MailingCountry: "USA",
      Account: { Name: "MIT" },
    });
    expect(mapped).toEqual({
      externalId: "003xx0001",
      name: "Margaret Hamilton",
      email: "margaret@mit.edu",
      phone: "+1 555 0142",
      company: "MIT",
      title: "Director of Software Engineering",
      location: "Cambridge, MA, USA",
    });
  });

  it("composes a name from First/Last when Name is absent, and skips when no name/email", () => {
    expect(
      salesforce.toImportedContact({ Id: "1", FirstName: "Ada", LastName: "Lovelace" })?.name
    ).toBe("Ada Lovelace");
    expect(salesforce.toImportedContact({ Id: "2", Email: "x@y.com" })?.name).toBe("x@y.com");
    expect(salesforce.toImportedContact({ Id: "3" })).toBeNull();
  });
});

describe("Outlook (Microsoft Graph) contact mapping", () => {
  it("maps a Graph contact, joins business address, prefers mobile phone", () => {
    const mapped = outlook.toImportedContact({
      id: "AAMkAD123",
      displayName: "Radia Perlman",
      givenName: "Radia",
      surname: "Perlman",
      emailAddresses: [{ address: "radia@spanningtree.net" }],
      mobilePhone: "+1 555 0170",
      businessPhones: ["+1 555 0199"],
      companyName: "Spanning Tree",
      jobTitle: "Network Engineer",
      businessAddress: { city: "Boston", state: "MA", countryOrRegion: "USA" },
    });
    expect(mapped).toEqual({
      externalId: "AAMkAD123",
      name: "Radia Perlman",
      email: "radia@spanningtree.net",
      phone: "+1 555 0170",
      company: "Spanning Tree",
      title: "Network Engineer",
      location: "Boston, MA, USA",
    });
  });

  it("falls back to business phone, then to composed/email name; skips empty", () => {
    expect(
      outlook.toImportedContact({ id: "1", givenName: "Grace", surname: "Hopper", businessPhones: ["+1 555 0100"] })
    ).toMatchObject({ name: "Grace Hopper", phone: "+1 555 0100" });
    expect(
      outlook.toImportedContact({ id: "2", emailAddresses: [{ address: "x@y.com" }] })?.name
    ).toBe("x@y.com");
    expect(outlook.toImportedContact({ id: "3" })).toBeNull();
  });
});

describe("Outlook calendar event mapping", () => {
  it("parses UTC times, lowercases emails, drops organizer from attendees", () => {
    const mapped = outlook.toImportedEvent({
      id: "evt1",
      subject: "Roadmap sync",
      start: { dateTime: "2026-07-01T15:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-01T16:00:00.0000000", timeZone: "UTC" },
      location: { displayName: "Room 4" },
      organizer: { emailAddress: { address: "Lead@Corp.com" } },
      attendees: [
        { emailAddress: { address: "Lead@Corp.com" } }, // organizer, excluded
        { emailAddress: { address: "Dev@Corp.com" } },
      ],
      webLink: "https://outlook.office365.com/evt1",
    });
    expect(mapped).toMatchObject({
      externalId: "evt1",
      title: "Roadmap sync",
      location: "Room 4",
      organizer: "lead@corp.com",
      attendees: ["dev@corp.com"],
      htmlLink: "https://outlook.office365.com/evt1",
    });
    expect(mapped?.startsAt.toISOString()).toBe("2026-07-01T15:00:00.000Z");
    expect(mapped?.endsAt?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });

  it("skips cancelled events and events with no start", () => {
    expect(
      outlook.toImportedEvent({ id: "x", isCancelled: true, start: { dateTime: "2026-07-01T15:00:00" } })
    ).toBeNull();
    expect(outlook.toImportedEvent({ id: "y" })).toBeNull();
  });
});

describe("Google calendar event mapping", () => {
  it("maps a timed event, drops self/resource attendees and the organizer", () => {
    const mapped = google.toImportedEvent({
      id: "g1",
      status: "confirmed",
      summary: "Design review",
      location: "Meet link",
      htmlLink: "https://calendar.google.com/g1",
      start: { dateTime: "2026-07-02T09:00:00-07:00" },
      end: { dateTime: "2026-07-02T10:00:00-07:00" },
      organizer: { email: "Host@Team.io" },
      attendees: [
        { email: "Host@Team.io" }, // organizer, excluded
        { email: "me@team.io", self: true }, // the connected user, excluded
        { email: "Room-A@team.io", resource: true }, // a room, excluded
        { email: "Guest@Team.io" },
      ],
    });
    expect(mapped).toMatchObject({
      externalId: "g1",
      title: "Design review",
      organizer: "host@team.io",
      attendees: ["guest@team.io"],
    });
    expect(mapped?.startsAt.toISOString()).toBe("2026-07-02T16:00:00.000Z");
  });

  it("skips cancelled events", () => {
    expect(
      google.toImportedEvent({ id: "g2", status: "cancelled", start: { dateTime: "2026-07-02T09:00:00Z" } })
    ).toBeNull();
  });
});

describe("planEventSync dedupe + prune", () => {
  const e = (externalId: string, title: string): ImportedEvent => ({
    externalId,
    title,
    startsAt: new Date("2026-07-01T15:00:00Z"),
    endsAt: new Date("2026-07-01T16:00:00Z"),
    location: null,
    organizer: "host@x.com",
    attendees: ["guest@x.com"],
    htmlLink: null,
  });

  it("creates new events, updates matched ones, deletes stale ones", () => {
    const incoming = [e("evt1", "Updated title"), e("evt3", "Brand new")];
    const existing: ExistingEvent[] = [
      { id: "row1", externalId: "evt1" }, // present → update
      { id: "row2", externalId: "evt2" }, // gone from provider → delete
    ];
    const plan = planEventSync(incoming, existing);
    expect(plan.summary).toMatchObject({ received: 2, created: 1, updated: 1, pruned: 1 });
    expect(plan.creates.map((c) => c.externalId)).toEqual(["evt3"]);
    expect(plan.updates[0]).toMatchObject({ id: "row1" });
    expect(plan.updates[0].fields.title).toBe("Updated title");
    expect(plan.deletes).toEqual(["row2"]);
  });

  it("dedupes a duplicate externalId within one pull", () => {
    const plan = planEventSync([e("evt1", "a"), e("evt1", "b")], []);
    expect(plan.summary).toMatchObject({ received: 1, created: 1 });
  });
});

describe("planSync dedupe", () => {
  const incoming: ImportedContact[] = [
    { externalId: "h1", name: "Ada Lovelace", email: "ada@x.com" },
    { externalId: "h2", name: "Grace Hopper", email: "grace@y.com" },
  ];

  it("creates contacts that don't exist yet", () => {
    const plan = planSync(incoming, [], "hubspot");
    expect(plan.summary).toMatchObject({ received: 2, created: 2, updated: 0, duplicates: 0, invalid: 0 });
    expect(plan.creates.map((c) => c.externalId).sort()).toEqual(["h1", "h2"]);
  });

  it("updates a previously-synced contact matched by externalId", () => {
    const existing: ExistingContact[] = [
      { id: "c1", name: "Ada L.", email: "ada-old@x.com", source: "hubspot", externalId: "h1" },
    ];
    const plan = planSync(incoming, existing, "hubspot");
    expect(plan.summary).toMatchObject({ created: 1, updated: 1, duplicates: 0 });
    expect(plan.updates[0]).toMatchObject({ id: "c1" });
    expect(plan.updates[0].fields.name).toBe("Ada Lovelace");
  });

  it("skips (does not overwrite) a contact that exists from another source by name+email", () => {
    const existing: ExistingContact[] = [
      { id: "c9", name: "Ada Lovelace", email: "ada@x.com", source: "manual", externalId: null },
    ];
    const plan = planSync(incoming, existing, "hubspot");
    expect(plan.summary).toMatchObject({ created: 1, updated: 0, duplicates: 1 });
    expect(plan.creates.map((c) => c.externalId)).toEqual(["h2"]);
  });

  it("dedupes a duplicate externalId within one pull", () => {
    const dupes: ImportedContact[] = [
      { externalId: "h1", name: "Ada Lovelace", email: "ada@x.com" },
      { externalId: "h1", name: "Ada Lovelace", email: "ada@x.com" },
    ];
    const plan = planSync(dupes, [], "hubspot");
    expect(plan.summary).toMatchObject({ created: 1, duplicates: 1 });
  });

  it("counts records with no usable name as invalid", () => {
    const bad: ImportedContact[] = [{ externalId: "h5", name: "", email: undefined }];
    const plan = planSync(bad, [], "hubspot");
    expect(plan.summary.invalid).toBe(1);
    expect(plan.creates).toHaveLength(0);
  });
});
