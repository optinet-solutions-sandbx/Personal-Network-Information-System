import { describe, it, expect } from "vitest";
import { computeNetworkStats } from "@/lib/network-intel";
import type { Contact } from "@/lib/types";

// Minimal Contact factory — only the fields computeNetworkStats reads matter.
function contact(p: Partial<Contact>): Contact {
  return {
    id: Math.random().toString(36).slice(2),
    name: "Test",
    email: null,
    phone: null,
    company: null,
    title: null,
    location: null,
    tags: null,
    birthday: null,
    howWeMet: null,
    customFields: null,
    profile: null,
    profileModel: null,
    profileUpdatedAt: null,
    healthScore: null,
    healthTier: null,
    healthInputs: null,
    followUpCadence: null,
    followUpCadenceDays: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...p,
  };
}

const NOW = new Date("2026-06-22T00:00:00.000Z");

describe("computeNetworkStats", () => {
  it("returns zeroed stats for an empty network", () => {
    const s = computeNetworkStats([], 0, NOW);
    expect(s.totalContacts).toBe(0);
    expect(s.connections).toBe(0);
    expect(s.topCompanies).toEqual([]);
    expect(s.growthByMonth).toHaveLength(12);
  });

  it("tallies top companies, locations and tags case-insensitively", () => {
    const contacts = [
      contact({ company: "Acme", location: "Lisbon", tags: "vip, lead" }),
      contact({ company: "acme", location: "Lisbon", tags: "VIP" }),
      contact({ company: "Globex", location: "Porto" }),
    ];
    const s = computeNetworkStats(contacts, 2, NOW);
    expect(s.totalContacts).toBe(3);
    expect(s.connections).toBe(2);
    expect(s.topCompanies[0]).toEqual({ label: "Acme", count: 2 });
    expect(s.topLocations[0]).toEqual({ label: "Lisbon", count: 2 });
    expect(s.topTags.find((t) => t.label.toLowerCase() === "vip")?.count).toBe(2);
  });

  it("buckets functional roles from title/tags", () => {
    const contacts = [
      contact({ title: "Senior Software Engineer" }),
      contact({ title: "Backend Developer" }),
      contact({ title: "VP of Sales" }),
    ];
    const s = computeNetworkStats(contacts, 0, NOW);
    const eng = s.topRoles.find((r) => r.label === "Engineering");
    expect(eng?.count).toBe(2);
    expect(s.topRoles.some((r) => r.label === "Sales")).toBe(true);
  });

  it("distributes health tiers and counts birthdays/notes", () => {
    const contacts = [
      contact({ healthTier: "Strong", birthday: "--05-14", _count: { notes: 3 } }),
      contact({ healthTier: "Dormant" }),
      contact({ healthTier: "Strong", _count: { notes: 0 } }),
    ];
    const s = computeNetworkStats(contacts, 0, NOW);
    expect(s.healthTiers.find((t) => t.label === "Strong")?.count).toBe(2);
    expect(s.healthTiers.find((t) => t.label === "Dormant")?.count).toBe(1);
    expect(s.withBirthday).toBe(1);
    expect(s.withNotes).toBe(1);
  });

  it("places new contacts in the correct growth month", () => {
    const contacts = [
      contact({ createdAt: "2026-06-10T00:00:00.000Z" }),
      contact({ createdAt: "2026-06-15T00:00:00.000Z" }),
      contact({ createdAt: "2026-05-02T00:00:00.000Z" }),
    ];
    const s = computeNetworkStats(contacts, 0, NOW);
    expect(s.growthByMonth.at(-1)).toEqual({ label: "2026-06", count: 2 });
    expect(s.growthByMonth.find((m) => m.label === "2026-05")?.count).toBe(1);
  });
});
