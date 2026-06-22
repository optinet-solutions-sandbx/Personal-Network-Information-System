// Client-facing shapes. Dates are serialized to ISO strings over the wire.

export type NoteSource = "manual" | "voice" | "story" | "gift";

export type GiftSuggestion = { title: string; rationale: string };

export type Note = {
  id: string;
  contactId: string;
  content: string;
  source: NoteSource;
  images: string[]; // photo attachments as data URLs (see lib/image.ts)
  createdAt: string;
  updatedAt: string;
};

export type HealthInputs = {
  recency: number;
  frequency: number;
  richness: number;
  lastNoteAt: string | null;
  noteCount90d: number;
  filledFields: number;
};

export type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  location: string | null;
  tags: string | null;
  birthday: string | null; // "YYYY-MM-DD" or "--MM-DD" (year unknown)
  howWeMet: string | null;
  customFields: Record<string, string> | null;
  // Immutable archive of the original add-flow input (text + photos), captured
  // at creation. Present on the detail endpoint; omitted from the list endpoint.
  sourceText?: string | null;
  sourceImages?: string[];
  profile: string | null;
  profileModel: string | null;
  profileUpdatedAt: string | null;
  healthScore: number | null;
  healthTier: string | null;
  healthInputs: HealthInputs | null;
  followUpCadence: string | null;
  followUpCadenceDays: number | null;
  createdAt: string;
  updatedAt: string;
  notes?: Note[];
  _count?: { notes: number };
};

export type InsightType = "birthday" | "follow_up" | "introduction" | "enrichment" | "cadence_due"
export type InsightPriority = 1 | 2 | 3

export type InsightItem = {
  type: InsightType
  priority: InsightPriority
  contactId: string
  contactName: string
  secondaryContactId?: string
  secondaryContactName?: string
  message: string
  actionUrl: string
  daysUntil?: number
  draftable?: boolean
}

export type Suggestion = {
  id: string;
  userId: string | null;
  contactAId: string;
  contactBId: string;
  contactA: { id: string; name: string; title: string | null; company: string | null };
  contactB: { id: string; name: string; title: string | null; company: string | null };
  rationale: string;
  score: number;
  status: "pending" | "accepted" | "dismissed";
  generatedAt: string;
  respondedAt: string | null;
};

export type ContactInput = {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  location?: string;
  tags?: string;
  birthday?: string;
  howWeMet?: string;
  customFields?: Record<string, string>;
};
