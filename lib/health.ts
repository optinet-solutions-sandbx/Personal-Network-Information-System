import { Contact, Note } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type ContactWithNotes = Contact & { notes: Note[] };

type HealthResult = {
  score: number;
  tier: string;
  inputs: {
    recency: number;
    frequency: number;
    richness: number;
    lastNoteAt: string | null;
    noteCount90d: number;
    filledFields: number;
  };
};

function computeRecency(notes: Note[]): { score: number; lastNoteAt: string | null } {
  if (notes.length === 0) return { score: 0, lastNoteAt: null };

  const latest = notes.reduce((a, b) =>
    a.createdAt > b.createdAt ? a : b
  );
  const lastNoteAt = latest.createdAt.toISOString();
  const daysSince =
    (Date.now() - latest.createdAt.getTime()) / (1000 * 60 * 60 * 24);

  let score: number;
  if (daysSince <= 7) score = 40;
  else if (daysSince <= 30) score = 30;
  else if (daysSince <= 90) score = 20;
  else if (daysSince <= 180) score = 10;
  else score = 0;

  return { score, lastNoteAt };
}

function computeFrequency(notes: Note[]): { score: number; noteCount90d: number } {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const noteCount90d = notes.filter((n) => n.createdAt >= cutoff).length;

  let score: number;
  if (noteCount90d >= 10) score = 30;
  else if (noteCount90d >= 5) score = 22;
  else if (noteCount90d >= 2) score = 15;
  else if (noteCount90d >= 1) score = 8;
  else score = 0;

  return { score, noteCount90d };
}

function computeRichness(contact: Contact): { score: number; filledFields: number } {
  const stringFields = [
    "email",
    "phone",
    "company",
    "title",
    "location",
    "tags",
    "howWeMet",
    "birthday",
    "profile",
  ] as const;

  let filledFields = 0;
  for (const field of stringFields) {
    const val = contact[field];
    if (val && val.trim().length > 0) filledFields++;
  }

  if (contact.customFields) {
    try {
      const parsed = JSON.parse(contact.customFields);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        filledFields++;
      }
    } catch {
      // malformed JSON — don't count
    }
  }

  return { score: Math.min(filledFields * 3, 30), filledFields };
}

function tierFromScore(score: number): string {
  if (score >= 75) return "Strong";
  if (score >= 50) return "Active";
  if (score >= 25) return "Fading";
  return "Dormant";
}

export function calculateHealthScore(contact: ContactWithNotes): HealthResult {
  const { score: recency, lastNoteAt } = computeRecency(contact.notes);
  const { score: frequency, noteCount90d } = computeFrequency(contact.notes);
  const { score: richness, filledFields } = computeRichness(contact);

  const score = recency + frequency + richness;

  return {
    score,
    tier: tierFromScore(score),
    inputs: { recency, frequency, richness, lastNoteAt, noteCount90d, filledFields },
  };
}

export async function recalculateHealth(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { notes: true },
  });
  if (!contact) return;

  const { score, tier, inputs } = calculateHealthScore(contact);

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      healthScore: score,
      healthTier: tier,
      healthInputs: JSON.stringify(inputs),
    },
  });
}
