// Connector registry — the single place that knows which providers exist.
// Routes and the sync runner resolve a Connector by its ProviderId here; adding
// a new provider (Google Contacts, Salesforce) is one import + one map entry.
//
// LinkedIn is intentionally absent: its contact API is closed to general apps,
// so LinkedIn stays a MANUAL flow (export connections CSV → /import). See the
// Phase 3 notes. Don't add a LinkedIn connector that scrapes.

import type { Connector, ProviderId } from "./types";
import { hubspotConnector } from "./hubspot";

const REGISTRY: Record<ProviderId, Connector> = {
  hubspot: hubspotConnector,
  // google: googleContactsConnector,    // TODO: next connector
  // salesforce: salesforceConnector,    // TODO: after Google
} as Record<ProviderId, Connector>;

export function getConnector(provider: string): Connector | null {
  return REGISTRY[provider as ProviderId] ?? null;
}

export function listConnectors(): Connector[] {
  return Object.values(REGISTRY);
}

export function isProviderId(value: string): value is ProviderId {
  return value in REGISTRY;
}
