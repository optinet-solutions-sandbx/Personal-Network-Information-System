// Salesforce connector (Phase 3, D7) — OAuth 2.0 web-server flow + the REST
// query API. The first per-instance provider: Salesforce returns a per-org
// `instance_url` at auth time which is the API base for that org, carried via
// AccessContext.apiBaseUrl (stored on the connection).
//
// Setup (one-time, in Salesforce, NOT in code):
//   1. In a Salesforce org (free Developer Edition works), Setup → App Manager
//      → New Connected App.
//   2. Enable OAuth Settings. Callback URL: <APP_ORIGIN>/api/connections/salesforce/callback
//   3. Selected OAuth scopes: "Manage user data via APIs (api)" and
//      "Perform requests at any time (refresh_token, offline_access)".
//   4. Save; copy the Consumer Key (client id) + Consumer Secret.
//   5. Environment:
//        SALESFORCE_CLIENT_ID=...
//        SALESFORCE_CLIENT_SECRET=...
//        SALESFORCE_LOGIN_URL=https://login.salesforce.com   (or https://test.salesforce.com for a sandbox)

import type {
  AccountInfo,
  Connector,
  ImportedContact,
  TokenSet,
} from "./types";
import { TokenExpiredError } from "./types";

const API_VERSION = "v60.0";
const SCOPES = ["api", "refresh_token"];
const MAX_PAGES = 100; // 100 * 2000 = 200k contacts ceiling

function loginUrl(): string {
  return (process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com").replace(/\/$/, "");
}
function clientId(): string {
  return process.env.SALESFORCE_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.SALESFORCE_CLIENT_SECRET ?? "";
}

// SOQL for the contact fields we map. Selected as a constant so it's easy to read.
const SOQL = [
  "SELECT Id, FirstName, LastName, Name, Email, Phone, Title,",
  "MailingCity, MailingState, MailingCountry, Account.Name",
  "FROM Contact",
].join(" ");

type SalesforceTokenResponse = {
  access_token: string;
  refresh_token?: string;
  instance_url?: string;
  scope?: string;
};

async function postForm(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${loginUrl()}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Salesforce token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as SalesforceTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: null, // Salesforce tokens have no expires_in; rely on 401 -> refresh
    scope: json.scope ?? SCOPES.join(" "),
    apiBaseUrl: json.instance_url ?? null,
  };
}

// ─── REST query response shapes (only the bits we read) ──────────────────────
type SalesforceContact = {
  Id: string;
  Name?: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  Email?: string | null;
  Phone?: string | null;
  Title?: string | null;
  MailingCity?: string | null;
  MailingState?: string | null;
  MailingCountry?: string | null;
  Account?: { Name?: string | null } | null;
};

function clean(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t || undefined;
}

function toImportedContact(c: SalesforceContact): ImportedContact | null {
  const name =
    clean(c.Name) ??
    clean([c.FirstName, c.LastName].filter(Boolean).join(" ")) ??
    clean(c.Email);
  if (!name || !c.Id) return null;
  const location = [c.MailingCity, c.MailingState, c.MailingCountry]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return {
    externalId: c.Id,
    name,
    email: clean(c.Email),
    phone: clean(c.Phone),
    company: clean(c.Account?.Name),
    title: clean(c.Title),
    location: location || undefined,
  };
}

export const salesforceConnector: Connector = {
  id: "salesforce",
  label: "Salesforce",
  authMode: "oauth",

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthorizeUrl(redirectUri, state) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId(),
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
      state,
    });
    return `${loginUrl()}/services/oauth2/authorize?${params.toString()}`;
  },

  exchangeCode(code, redirectUri) {
    return postForm({
      grant_type: "authorization_code",
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      code,
    });
  },

  refresh(refreshToken) {
    return postForm({
      grant_type: "refresh_token",
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
    });
  },

  async getAccountInfo({ accessToken, apiBaseUrl }): Promise<AccountInfo> {
    if (!apiBaseUrl) return { externalAccountId: null, label: null };
    const res = await fetch(`${apiBaseUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { externalAccountId: null, label: null };
    const json = (await res.json()) as { organization_id?: string; email?: string; name?: string };
    return {
      externalAccountId: json.organization_id ?? null,
      label: json.email || json.name || null,
    };
  },

  async fetchContacts({ accessToken, apiBaseUrl }): Promise<ImportedContact[]> {
    if (!apiBaseUrl) throw new Error("Salesforce instance URL is missing — reconnect required");
    const out: ImportedContact[] = [];

    // First page via the query endpoint; subsequent pages via nextRecordsUrl.
    let nextPath: string | null = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(SOQL)}`;

    for (let page = 0; page < MAX_PAGES && nextPath; page++) {
      const res: Response = await fetch(`${apiBaseUrl}${nextPath}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401) throw new TokenExpiredError();
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Salesforce query failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        records?: SalesforceContact[];
        done?: boolean;
        nextRecordsUrl?: string;
      };
      for (const rec of json.records ?? []) {
        const mapped = toImportedContact(rec);
        if (mapped) out.push(mapped);
      }
      nextPath = json.done === false && json.nextRecordsUrl ? json.nextRecordsUrl : null;
    }
    return out;
  },
};

// Exported for unit tests.
export const __test = { toImportedContact };
