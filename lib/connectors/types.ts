// Provider-agnostic contract for a contact-source connector (Phase 3, D7).
// Each CRM/address-book provider (HubSpot, Google Contacts, Salesforce, …)
// implements this once; the OAuth routes, the registry, and the sync runner are
// all written against the interface and never reference a specific provider.
//
// Design notes:
//  - OAuth is authorization-code flow. The provider hands back an access token
//    (short-lived) + usually a refresh token (long-lived). We store both
//    ENCRYPTED (see lib/crypto.ts) and refresh lazily right before a sync.
//  - A connector is a stateless object: it takes tokens in and returns data
//    out. It does NOT touch the DB — persistence is the routes' job. This keeps
//    connectors pure and unit-testable (mock `fetch`, assert the mapping).

import type { ContactInput } from "@/lib/types";

export type ProviderId = "hubspot" | "google" | "salesforce" | "outlook";

// How a connector authenticates:
//  - "oauth": the redirect/consent + code-exchange flow (getAuthorizeUrl →
//    exchangeCode → refresh). Used when end users connect their OWN accounts.
//  - "token": the user pastes a long-lived access token they generated in the
//    provider (e.g. a HubSpot "Private app" token). No redirect, no refresh.
export type AuthMode = "oauth" | "token";

// A contact pulled from a provider: the standard editable fields plus the
// provider's stable record id, which the sync runner uses to dedupe across
// re-syncs (so editing a HubSpot contact and re-syncing UPDATES rather than
// duplicates). `externalId` must be stable for the lifetime of the record.
export type ImportedContact = ContactInput & { externalId: string };

// A calendar event pulled from a provider (Google Calendar, Outlook). Only the
// fields meeting-prep/follow-ups need. `attendees`/`organizer` are email
// addresses (lowercased by the connector) so they can be matched against
// Contact.email; `externalId` is the provider's stable event id, used to dedupe
// across re-syncs (see lib/connectors/calendar-sync.ts).
export type ImportedEvent = {
  externalId: string;
  title: string | null;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  organizer: string | null; // organizer email, lowercased
  attendees: string[]; // attendee emails, lowercased, organizer excluded
  htmlLink: string | null; // deep link back to the event in the provider, if any
};

// The time range to pull events for. Connectors must only return events that
// start within [timeMin, timeMax); the sync runner also prunes outside it.
export type EventWindow = { timeMin: Date; timeMax: Date };

// The result of an OAuth token exchange or refresh.
export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null; // some providers omit it on refresh — keep the old one
  expiresAt?: Date | null; // null = unknown/non-expiring
  scope?: string | null;
  // Per-instance API base, for providers whose API host varies by account
  // (Salesforce returns `instance_url`). Persisted on the connection and passed
  // back to fetchContacts/getAccountInfo via AccessContext.
  apiBaseUrl?: string | null;
};

// What a connector needs to make an authenticated API call: the access token
// plus, for per-instance providers, the API base. Fixed-host providers (HubSpot,
// Google) ignore apiBaseUrl.
export type AccessContext = {
  accessToken: string;
  apiBaseUrl?: string | null;
};

// Identity of the connected account, shown in the UI (e.g. the HubSpot portal
// name, or the Google account email).
export type AccountInfo = {
  externalAccountId: string | null;
  label: string | null;
};

export interface Connector {
  readonly id: ProviderId;
  readonly label: string; // human name, e.g. "HubSpot"
  readonly authMode: AuthMode;

  // True when the provider is usable on this server. For "oauth" connectors this
  // means the OAuth app credentials (CLIENT_ID + CLIENT_SECRET) are present in
  // the environment. For "token" connectors no server-side creds are needed (the
  // user supplies the token), so this is typically always true. When false the
  // provider shows as "not configured" in the UI and its routes 503.
  isConfigured(): boolean;

  // Build the provider's authorization URL to redirect the user to. `state` is
  // an opaque CSRF token we mint and verify on the callback.
  getAuthorizeUrl(redirectUri: string, state: string): string;

  // Exchange the authorization `code` from the callback for tokens.
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;

  // Trade a refresh token for a fresh access token.
  refresh(refreshToken: string): Promise<TokenSet>;

  // Identify the connected account (best-effort; may return nulls).
  getAccountInfo(ctx: AccessContext): Promise<AccountInfo>;

  // "token" connectors only: validate a user-pasted token and return account
  // info. Should THROW with a human-readable message when the token is invalid
  // or lacks the required scope. Omitted by "oauth" connectors.
  verifyToken?(token: string): Promise<AccountInfo>;

  // Pull all contacts from the provider, paginating internally. Returns mapped
  // ImportedContacts ready for the sync runner.
  fetchContacts(ctx: AccessContext): Promise<ImportedContact[]>;

  // Calendar-capable providers (Google Calendar, Outlook) implement this to pull
  // events in a time window, paginating internally. Contact-only CRMs (HubSpot,
  // Salesforce) OMIT it; the sync runner checks for its presence before syncing
  // events (see lib/connectors/run.ts). Throws TokenExpiredError on a 401.
  fetchEvents?(ctx: AccessContext, window: EventWindow): Promise<ImportedEvent[]>;
}

// Narrow a connector to one that can pull calendar events.
export function isCalendarCapable(
  c: Connector
): c is Connector & Required<Pick<Connector, "fetchEvents">> {
  return typeof c.fetchEvents === "function";
}

// Thrown by connectors on an auth failure where the access token is stale and a
// refresh should be attempted (HTTP 401 from the provider). The routes catch
// this to drive the lazy-refresh-then-retry path.
export class TokenExpiredError extends Error {
  constructor(message = "access token expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}
