// Google Contacts connector (Phase 3, D7) — OAuth 2.0 + the People API.
// The second connector, and the first true OAuth one (HubSpot uses a pasted
// token). Proves the redirect/consent → code-exchange → refresh path.
//
// Setup (one-time, in Google Cloud Console, NOT in code):
//   1. Create a project at https://console.cloud.google.com.
//   2. APIs & Services → enable the "People API".
//   3. OAuth consent screen → External → add your email as a test user
//      (keeps you in "testing" mode so no Google verification is needed).
//   4. Credentials → Create OAuth client ID → Web application.
//      Authorized redirect URI: <APP_ORIGIN>/api/connections/google/callback
//   5. Put the client ID/secret in the environment:
//        GOOGLE_CLIENT_ID=...
//        GOOGLE_CLIENT_SECRET=...
//      and set APP_ORIGIN so the redirect URI matches exactly.

import type {
  AccountInfo,
  Connector,
  ImportedContact,
  TokenSet,
} from "./types";
import { TokenExpiredError } from "./types";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PEOPLE_API = "https://people.googleapis.com/v1/people/me/connections";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/userinfo.email", // for the account label
];

// Fields the People API should return for each connection.
const PERSON_FIELDS = ["names", "emailAddresses", "phoneNumbers", "organizations", "addresses"].join(",");
const PAGE_SIZE = 1000; // People API max
const MAX_PAGES = 50; // 50k contacts ceiling

function clientId(): string {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

async function postForm(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as GoogleTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt:
      typeof json.expires_in === "number"
        ? new Date(Date.now() + json.expires_in * 1000)
        : null,
    scope: json.scope ?? SCOPES.join(" "),
  };
}

// ─── People API response shapes (only the bits we read) ──────────────────────
type GooglePerson = {
  resourceName: string; // stable id, e.g. "people/c12345"
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
  addresses?: { city?: string; formattedValue?: string }[];
};

function firstVal<T, K extends keyof T>(arr: T[] | undefined, key: K): string | undefined {
  const v = arr?.[0]?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function toImportedContact(p: GooglePerson): ImportedContact | null {
  const name = firstVal(p.names, "displayName") ?? firstVal(p.emailAddresses, "value");
  if (!name || !p.resourceName) return null;
  const org = p.organizations?.[0];
  const addr = p.addresses?.[0];
  return {
    externalId: p.resourceName,
    name,
    email: firstVal(p.emailAddresses, "value"),
    phone: firstVal(p.phoneNumbers, "value"),
    company: org?.name?.trim() || undefined,
    title: org?.title?.trim() || undefined,
    location: addr?.city?.trim() || addr?.formattedValue?.trim() || undefined,
  };
}

export const googleConnector: Connector = {
  id: "google",
  label: "Google Contacts",
  authMode: "oauth",

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthorizeUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline", // ask for a refresh token
      prompt: "consent", // force the refresh token even on re-auth
      include_granted_scopes: "true",
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
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

  async getAccountInfo(accessToken): Promise<AccountInfo> {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { externalAccountId: null, label: null };
    const json = (await res.json()) as { id?: string; email?: string };
    return { externalAccountId: json.id ?? null, label: json.email ?? null };
  },

  async fetchContacts(accessToken): Promise<ImportedContact[]> {
    const out: ImportedContact[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        personFields: PERSON_FIELDS,
        pageSize: String(PAGE_SIZE),
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(`${PEOPLE_API}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401) throw new TokenExpiredError();
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google contacts fetch failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        connections?: GooglePerson[];
        nextPageToken?: string;
      };
      for (const person of json.connections ?? []) {
        const mapped = toImportedContact(person);
        if (mapped) out.push(mapped);
      }
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  },
};

// Exported for unit tests.
export const __test = { toImportedContact };
