// Outlook / Microsoft 365 connector (Phase 3, D7) — OAuth 2.0 (Microsoft
// identity platform v2.0) + the Microsoft Graph API. The first dual-capability
// connector: it pulls BOTH contacts (/me/contacts) and calendar events
// (/me/calendarView), so it implements fetchContacts AND the optional
// fetchEvents.
//
// Setup (one-time, in the Azure portal, NOT in code):
//   1. Azure Portal → "App registrations" → New registration.
//      - Supported account types: "Accounts in any organizational directory and
//        personal Microsoft accounts" (lets both work + personal Outlook sign in).
//      - Redirect URI (Web): <APP_ORIGIN>/api/connections/outlook/callback
//   2. "Certificates & secrets" → New client secret → copy the VALUE.
//   3. "API permissions" → Microsoft Graph → Delegated:
//        Contacts.Read, Calendars.Read, User.Read, offline_access  → Grant.
//   4. Environment:
//        MICROSOFT_CLIENT_ID=...
//        MICROSOFT_CLIENT_SECRET=...
//        MICROSOFT_TENANT=common            (default; use a tenant id to restrict)
//      and set APP_ORIGIN so the redirect URI matches exactly.

import type {
  AccessContext,
  AccountInfo,
  Connector,
  EventWindow,
  ImportedContact,
  ImportedEvent,
  TokenSet,
} from "./types";
import { TokenExpiredError } from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
// Delegated scopes. offline_access is what gets us a refresh token.
const SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Contacts.Read",
  "Calendars.Read",
];
const CONTACTS_PAGE_SIZE = 100;
const EVENTS_PAGE_SIZE = 100;
const MAX_PAGES = 100; // 10k contacts / events ceiling per sync

function tenant(): string {
  return (process.env.MICROSOFT_TENANT || "common").trim();
}
function clientId(): string {
  return process.env.MICROSOFT_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.MICROSOFT_CLIENT_SECRET ?? "";
}
function authBase(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
}

type MsTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

async function postForm(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${authBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Microsoft token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as MsTokenResponse;
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

// ─── Graph response shapes (only the bits we read) ───────────────────────────
type GraphContact = {
  id: string;
  displayName?: string | null;
  givenName?: string | null;
  surname?: string | null;
  emailAddresses?: { address?: string | null }[];
  mobilePhone?: string | null;
  businessPhones?: string[];
  companyName?: string | null;
  jobTitle?: string | null;
  businessAddress?: { city?: string | null; state?: string | null; countryOrRegion?: string | null } | null;
};

type GraphEmailAddress = { name?: string | null; address?: string | null };
type GraphEvent = {
  id: string;
  subject?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  location?: { displayName?: string | null } | null;
  organizer?: { emailAddress?: GraphEmailAddress | null } | null;
  attendees?: { emailAddress?: GraphEmailAddress | null }[];
  webLink?: string | null;
  isCancelled?: boolean | null;
};

function clean(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t || undefined;
}

function toImportedContact(c: GraphContact): ImportedContact | null {
  const email = clean(c.emailAddresses?.[0]?.address ?? undefined);
  const name =
    clean(c.displayName) ??
    clean([c.givenName, c.surname].filter(Boolean).join(" ")) ??
    email;
  if (!name || !c.id) return null;
  const a = c.businessAddress;
  const location = [a?.city, a?.state, a?.countryOrRegion]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return {
    externalId: c.id,
    name,
    email,
    phone: clean(c.mobilePhone) ?? clean(c.businessPhones?.[0]),
    company: clean(c.companyName),
    title: clean(c.jobTitle),
    location: location || undefined,
  };
}

// Microsoft returns naive local datetimes plus a separate timeZone. Combine them
// into a real instant. Graph's calendarView with Prefer: outlook.timezone="UTC"
// returns UTC strings, so we request that header and parse as UTC.
function parseGraphDate(d: { dateTime?: string | null } | null | undefined): Date | null {
  const s = clean(d?.dateTime ?? undefined);
  if (!s) return null;
  // dateTime has no offset; we ask Graph for UTC (see Prefer header) → append Z.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toImportedEvent(e: GraphEvent): ImportedEvent | null {
  if (e.isCancelled) return null;
  const startsAt = parseGraphDate(e.start);
  if (!e.id || !startsAt) return null;
  const organizer = clean(e.organizer?.emailAddress?.address ?? undefined)?.toLowerCase() ?? null;
  const attendees = Array.from(
    new Set(
      (e.attendees ?? [])
        .map((a) => clean(a.emailAddress?.address ?? undefined)?.toLowerCase())
        .filter((a): a is string => Boolean(a) && a !== organizer)
    )
  );
  return {
    externalId: e.id,
    title: clean(e.subject) ?? null,
    startsAt,
    endsAt: parseGraphDate(e.end),
    location: clean(e.location?.displayName ?? undefined) ?? null,
    organizer,
    attendees,
    htmlLink: clean(e.webLink ?? undefined) ?? null,
  };
}

export const outlookConnector: Connector = {
  id: "outlook",
  label: "Outlook",
  authMode: "oauth",

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthorizeUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: clientId(),
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: SCOPES.join(" "),
      state,
    });
    return `${authBase()}/authorize?${params.toString()}`;
  },

  exchangeCode(code, redirectUri) {
    return postForm({
      grant_type: "authorization_code",
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      scope: SCOPES.join(" "),
      code,
    });
  },

  refresh(refreshToken) {
    return postForm({
      grant_type: "refresh_token",
      client_id: clientId(),
      client_secret: clientSecret(),
      scope: SCOPES.join(" "),
      refresh_token: refreshToken,
    });
  },

  async getAccountInfo({ accessToken }: AccessContext): Promise<AccountInfo> {
    const res = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { externalAccountId: null, label: null };
    const json = (await res.json()) as { id?: string; mail?: string; userPrincipalName?: string };
    return {
      externalAccountId: json.id ?? null,
      label: json.mail || json.userPrincipalName || null,
    };
  },

  async fetchContacts({ accessToken }: AccessContext): Promise<ImportedContact[]> {
    const out: ImportedContact[] = [];
    let next: string | null =
      `${GRAPH}/me/contacts?$top=${CONTACTS_PAGE_SIZE}` +
      `&$select=id,displayName,givenName,surname,emailAddresses,mobilePhone,businessPhones,companyName,jobTitle,businessAddress`;

    for (let page = 0; page < MAX_PAGES && next; page++) {
      const res: Response = await fetch(next, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401) throw new TokenExpiredError();
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Microsoft contacts fetch failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as { value?: GraphContact[]; "@odata.nextLink"?: string };
      for (const c of json.value ?? []) {
        const mapped = toImportedContact(c);
        if (mapped) out.push(mapped);
      }
      next = json["@odata.nextLink"] ?? null;
    }
    return out;
  },

  async fetchEvents({ accessToken }: AccessContext, window: EventWindow): Promise<ImportedEvent[]> {
    const out: ImportedEvent[] = [];
    const params = new URLSearchParams({
      startDateTime: window.timeMin.toISOString(),
      endDateTime: window.timeMax.toISOString(),
      $top: String(EVENTS_PAGE_SIZE),
      $orderby: "start/dateTime",
      $select: "id,subject,start,end,location,organizer,attendees,webLink,isCancelled",
    });
    let next: string | null = `${GRAPH}/me/calendarView?${params.toString()}`;

    for (let page = 0; page < MAX_PAGES && next; page++) {
      const res: Response = await fetch(next, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // Ask Graph to return event times already normalized to UTC.
          Prefer: 'outlook.timezone="UTC"',
        },
      });
      if (res.status === 401) throw new TokenExpiredError();
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Microsoft calendar fetch failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as { value?: GraphEvent[]; "@odata.nextLink"?: string };
      for (const e of json.value ?? []) {
        const mapped = toImportedEvent(e);
        if (mapped) out.push(mapped);
      }
      next = json["@odata.nextLink"] ?? null;
    }
    return out;
  },
};

// Exported for unit tests.
export const __test = { toImportedContact, toImportedEvent, parseGraphDate };
