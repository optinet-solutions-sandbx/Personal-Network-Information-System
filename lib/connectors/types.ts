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

export type ProviderId = "hubspot" | "google" | "salesforce";

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

// The result of an OAuth token exchange or refresh.
export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null; // some providers omit it on refresh — keep the old one
  expiresAt?: Date | null; // null = unknown/non-expiring
  scope?: string | null;
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
  getAccountInfo(accessToken: string): Promise<AccountInfo>;

  // "token" connectors only: validate a user-pasted token and return account
  // info. Should THROW with a human-readable message when the token is invalid
  // or lacks the required scope. Omitted by "oauth" connectors.
  verifyToken?(token: string): Promise<AccountInfo>;

  // Pull all contacts from the provider, paginating internally. Returns mapped
  // ImportedContacts ready for the sync runner.
  fetchContacts(accessToken: string): Promise<ImportedContact[]>;
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
