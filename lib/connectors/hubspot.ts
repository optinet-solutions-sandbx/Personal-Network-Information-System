// HubSpot connector — the first live CRM integration (Phase 3, D7) and the
// reference implementation of the Connector interface. Uses HubSpot's OAuth 2.0
// authorization-code flow and the CRM v3 contacts API.
//
// Setup (one-time, done by an admin in HubSpot, NOT in code):
//   1. Create an app at https://developers.hubspot.com → Auth tab.
//   2. Add redirect URL: <APP_ORIGIN>/api/connections/hubspot/callback
//   3. Add scope: crm.objects.contacts.read
//   4. Put the app's Client ID / Secret in the environment:
//        HUBSPOT_CLIENT_ID=...
//        HUBSPOT_CLIENT_SECRET=...
//
// Mapping: HubSpot stores names split (firstname/lastname) and the job title as
// `jobtitle`; we compose the name and fold the rest into our standard fields.

import type {
  AccountInfo,
  Connector,
  ImportedContact,
  TokenSet,
} from "./types";
import { TokenExpiredError } from "./types";

const AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const API_BASE = "https://api.hubapi.com";
const SCOPES = ["crm.objects.contacts.read"];

// Contact properties we ask HubSpot to return (HubSpot only sends requested
// non-default properties).
const PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "company",
  "jobtitle",
  "city",
  "state",
  "country",
];

const PAGE_LIMIT = 100; // HubSpot max page size for this endpoint
const MAX_PAGES = 100; // hard ceiling so a huge portal can't loop forever (10k contacts)

type HubSpotTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // seconds
};

type HubSpotContact = {
  id: string;
  properties: Record<string, string | null>;
};

function clientId(): string {
  return process.env.HUBSPOT_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.HUBSPOT_CLIENT_SECRET ?? "";
}

async function postForm(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as HubSpotTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt:
      typeof json.expires_in === "number"
        ? new Date(Date.now() + json.expires_in * 1000)
        : null,
    scope: SCOPES.join(" "),
  };
}

function composeName(p: Record<string, string | null>): string {
  const name = [p.firstname, p.lastname].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  // Fall back to email local-part, then a placeholder, so a nameless HubSpot
  // record still imports (the sync runner requires a name).
  if (name) return name;
  if (p.email) return p.email.split("@")[0];
  return "";
}

function composeLocation(p: Record<string, string | null>): string | undefined {
  const loc = [p.city, p.state, p.country].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  return loc || undefined;
}

function toImportedContact(c: HubSpotContact): ImportedContact | null {
  const p = c.properties ?? {};
  const name = composeName(p);
  if (!name) return null; // unusable record — skip
  return {
    externalId: c.id,
    name,
    email: p.email?.trim() || undefined,
    phone: p.phone?.trim() || undefined,
    company: p.company?.trim() || undefined,
    title: p.jobtitle?.trim() || undefined,
    location: composeLocation(p),
  };
}

export const hubspotConnector: Connector = {
  id: "hubspot",
  label: "HubSpot",
  // HubSpot disabled new public (OAuth) legacy apps from the UI, so we connect
  // via a user-pasted "Private app" token. The OAuth methods below remain
  // implemented for the day we move to a Projects-platform public app.
  authMode: "token",

  isConfigured() {
    // Token mode needs no server-side credentials — the user supplies the token
    // at connect time. (The route layer still requires CONNECTION_ENC_KEY to
    // store it.)
    return true;
  },

  // Validate a HubSpot Private-app token by probing the contacts API with it,
  // then best-effort fetch the portal id for a label.
  async verifyToken(token): Promise<AccountInfo> {
    const probe = await fetch(`${API_BASE}/crm/v3/objects/contacts?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (probe.status === 401) throw new Error("Token is invalid or expired.");
    if (probe.status === 403) {
      throw new Error("Token is missing the crm.objects.contacts.read scope.");
    }
    if (!probe.ok) {
      throw new Error(`HubSpot rejected the token (HTTP ${probe.status}).`);
    }
    const info = (await fetch(`${API_BASE}/account-info/v3/details`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as { portalId?: number } | null;
    return {
      externalAccountId: info?.portalId != null ? String(info.portalId) : null,
      label: info?.portalId != null ? `HubSpot portal ${info.portalId}` : "HubSpot (private app)",
    };
  },

  getAuthorizeUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
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
    // The token-info endpoint echoes the portal (hub) and signing user.
    const res = await fetch(`${API_BASE}/oauth/v1/access-tokens/${accessToken}`);
    if (!res.ok) return { externalAccountId: null, label: null };
    const json = (await res.json()) as {
      hub_id?: number;
      hub_domain?: string;
      user?: string;
    };
    return {
      externalAccountId: json.hub_id != null ? String(json.hub_id) : null,
      label: json.hub_domain || json.user || null,
    };
  },

  async fetchContacts(accessToken): Promise<ImportedContact[]> {
    const out: ImportedContact[] = [];
    let after: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      params.set("properties", PROPERTIES.join(","));
      if (after) params.set("after", after);

      const res = await fetch(`${API_BASE}/crm/v3/objects/contacts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401) throw new TokenExpiredError();
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HubSpot contacts fetch failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        results?: HubSpotContact[];
        paging?: { next?: { after?: string } };
      };
      for (const c of json.results ?? []) {
        const mapped = toImportedContact(c);
        if (mapped) out.push(mapped);
      }
      after = json.paging?.next?.after;
      if (!after) break;
    }
    return out;
  },
};

// Exported for unit tests (mapping is pure and worth pinning down).
export const __test = { toImportedContact, composeName, composeLocation };
