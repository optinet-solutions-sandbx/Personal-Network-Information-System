// Relationship ("who knows whom") types shared by the API, the contact-page
// Connections section, and the /network graph. Framework-free so it's safe to
// import from both server routes and client components.

export type RelationshipType =
  | "knows"
  | "colleague"
  | "friend"
  | "family"
  | "partner"
  | "introduced_by"
  | "manager"
  | "report"
  | "mentor"
  | "client"
  | "investor"
  | "other";

// `symmetric` types read the same both ways ("A knows B" == "B knows A"); the
// rest are directional and read from -> to ("A introduced_by B" => B introduced A).
// `label` is the from->to phrasing shown in the UI.
export const RELATIONSHIP_TYPES: {
  value: RelationshipType;
  label: string;
  symmetric: boolean;
}[] = [
  { value: "knows", label: "Knows", symmetric: true },
  { value: "colleague", label: "Colleague of", symmetric: true },
  { value: "friend", label: "Friend of", symmetric: true },
  { value: "family", label: "Family of", symmetric: true },
  { value: "partner", label: "Business partner of", symmetric: true },
  { value: "introduced_by", label: "Introduced by", symmetric: false },
  { value: "manager", label: "Manages", symmetric: false },
  { value: "report", label: "Reports to", symmetric: false },
  { value: "mentor", label: "Mentor to", symmetric: false },
  { value: "client", label: "Client of", symmetric: false },
  { value: "investor", label: "Investor in", symmetric: false },
  { value: "other", label: "Connected to", symmetric: true },
];

const BY_VALUE = new Map(RELATIONSHIP_TYPES.map((t) => [t.value, t]));

export function isRelationshipType(v: unknown): v is RelationshipType {
  return typeof v === "string" && BY_VALUE.has(v as RelationshipType);
}

export function relationshipLabel(type: string): string {
  return BY_VALUE.get(type as RelationshipType)?.label ?? "Connected to";
}

export function isSymmetric(type: string): boolean {
  return BY_VALUE.get(type as RelationshipType)?.symmetric ?? true;
}

// A node + its neighbour, as the contact-page Connections section consumes it.
export type ContactRef = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
};

export type RelationshipEdge = {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipType;
  strength: number;
  note: string | null;
  createdAt: string;
};

// Edge enriched with the "other" contact relative to a focused contact — what
// the contact-page Connections list renders.
export type ConnectionView = RelationshipEdge & {
  other: ContactRef;
  // true when the focused contact is the edge's `from` (matters for direction).
  outgoing: boolean;
};

// Graph payload for /network.
export type GraphNode = ContactRef & { degree: number };
export type GraphData = { nodes: GraphNode[]; edges: RelationshipEdge[] };
