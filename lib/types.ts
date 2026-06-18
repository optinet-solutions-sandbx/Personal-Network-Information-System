// Client-facing shapes. Dates are serialized to ISO strings over the wire.

export type NoteSource = "manual" | "voice" | "story";

export type Note = {
  id: string;
  contactId: string;
  content: string;
  source: NoteSource;
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
  profile: string | null;
  profileModel: string | null;
  profileUpdatedAt: string | null;
  healthScore: number | null;
  healthTier: string | null;
  healthInputs: HealthInputs | null;
  createdAt: string;
  updatedAt: string;
  notes?: Note[];
  _count?: { notes: number };
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
