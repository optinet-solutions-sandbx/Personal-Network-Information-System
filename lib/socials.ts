// Maps a social/messaging custom field (key + value) to a canonical, clickable
// profile link. Used to render "verified" social links on contacts — verified
// because these handles come only from the user's note / a scanned card (a
// primary source), never from web enrichment (see isSocialKey usage in
// lib/extract.ts, which blocks the web from inventing socials).

export type ResolvedSocial = {
  platform: string; // canonical id, e.g. "telegram"
  label: string; // display name, e.g. "Telegram"
  icon: string; // emoji glyph
  handle: string; // human-readable handle, e.g. "@PlayStar123"
  url: string; // canonical https URL
};

type PlatformDef = {
  id: string;
  label: string;
  icon: string;
  keyRe: RegExp; // matches the custom-field key (the platform name)
  domainRe?: RegExp; // matches the host when the value is a full URL
  build: (handle: string) => string; // build a URL from a bare handle
};

const stripHandle = (v: string) => v.trim().replace(/^@+/, "").replace(/^\/+|\/+$/g, "");
const digits = (v: string) => v.replace(/[^\d]/g, "");

// Order matters: more specific keys (linkedin) before looser ones.
const PLATFORMS: PlatformDef[] = [
  { id: "linkedin", label: "LinkedIn", icon: "💼", keyRe: /linked\s*-?in/i, domainRe: /(^|\.)linkedin\.com$/i, build: (h) => `https://www.linkedin.com/in/${h}` },
  { id: "telegram", label: "Telegram", icon: "✈️", keyRe: /tele\s*gram|^tg$/i, domainRe: /(^|\.)(t\.me|telegram\.(me|org))$/i, build: (h) => `https://t.me/${h}` },
  { id: "instagram", label: "Instagram", icon: "📷", keyRe: /insta\s*gram|^ig$/i, domainRe: /(^|\.)instagram\.com$/i, build: (h) => `https://instagram.com/${h}` },
  { id: "facebook", label: "Facebook", icon: "📘", keyRe: /face\s*book|^fb$/i, domainRe: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i, build: (h) => `https://facebook.com/${h}` },
  { id: "x", label: "X", icon: "𝕏", keyRe: /twitter|^x$|x\s*\(?\s*twitter|x\s*\/\s*twitter/i, domainRe: /(^|\.)(twitter\.com|x\.com)$/i, build: (h) => `https://x.com/${h}` },
  { id: "whatsapp", label: "WhatsApp", icon: "💬", keyRe: /whats\s*app|^wa$/i, domainRe: /(^|\.)(wa\.me|whatsapp\.com)$/i, build: (h) => `https://api.whatsapp.com/send?phone=${digits(h)}` },
  { id: "github", label: "GitHub", icon: "🐙", keyRe: /git\s*hub/i, domainRe: /(^|\.)github\.com$/i, build: (h) => `https://github.com/${h}` },
  { id: "youtube", label: "YouTube", icon: "▶️", keyRe: /you\s*tube|^yt$/i, domainRe: /(^|\.)(youtube\.com|youtu\.be)$/i, build: (h) => `https://youtube.com/@${h.replace(/^@/, "")}` },
  { id: "tiktok", label: "TikTok", icon: "🎵", keyRe: /tik\s*tok/i, domainRe: /(^|\.)tiktok\.com$/i, build: (h) => `https://tiktok.com/@${h.replace(/^@/, "")}` },
  { id: "snapchat", label: "Snapchat", icon: "👻", keyRe: /snap\s*chat|^snap$/i, domainRe: /(^|\.)snapchat\.com$/i, build: (h) => `https://snapchat.com/add/${h}` },
  { id: "threads", label: "Threads", icon: "🧵", keyRe: /threads/i, domainRe: /(^|\.)threads\.net$/i, build: (h) => `https://threads.net/@${h.replace(/^@/, "")}` },
  { id: "website", label: "Website", icon: "🌐", keyRe: /web\s*site|^url$|home\s*page|^web$|^site$/i, build: (h) => (/^https?:\/\//i.test(h) ? h : `https://${h}`) },
];

// Build clickable links for a raw phone number: a `tel:` URI for click-to-call
// and a WhatsApp click-to-chat URL. We use the long official endpoint
// (api.whatsapp.com/send) rather than the wa.me shortener — both are WhatsApp's
// own, but the shortener is more often broken by AV/proxy TLS interception, and
// api.whatsapp.com sits under the same *.whatsapp.com domain as WhatsApp Web.
// The WhatsApp link is best-effort — it only resolves for an international
// number (with country code, no leading 0), same caveat as a WhatsApp custom
// field; we keep a leading "+" on the tel: link to help dialers.
export function phoneLinks(raw: string): { tel: string; whatsapp: string } | null {
  const d = digits(raw);
  if (d.length < 7) return null; // too short to be a real number
  const plus = /^\s*\+/.test(raw) ? "+" : "";
  return { tel: `tel:${plus}${d}`, whatsapp: `https://api.whatsapp.com/send?phone=${d}` };
}

// Find the first custom field that resolves to a given platform (e.g.
// "telegram" or "whatsapp"), regardless of the exact key the extractor stored it
// under ("Telegram", "TG", a t.me URL under a generic key, …). Lets the contact
// page surface a dedicated, clickable messaging link without a schema change.
export function findSocial(
  customFields: Record<string, string> | null | undefined,
  platform: string
): { key: string; social: ResolvedSocial } | null {
  if (!customFields) return null;
  for (const [key, value] of Object.entries(customFields)) {
    const social = resolveSocial(key, value);
    if (social && social.platform === platform) return { key, social };
  }
  return null;
}

// True when a custom-field key names a social platform. lib/extract.ts uses this
// to ensure web enrichment can never inject a social handle — so any social on a
// saved contact is primary-source and can be shown as "verified".
export function isSocialKey(key: string): boolean {
  return PLATFORMS.some((p) => p.keyRe.test(key));
}

// Parse the host out of a value that looks like a URL (with or without scheme).
function urlHost(value: string): string | null {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    // Only treat as a URL if it has a dot in the host — avoids "@handle" parsing.
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function handleFromUrl(value: string, def: PlatformDef): string {
  if (def.id === "website") return urlHost(value) ?? value;
  const path = value.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+|\/+$/g, "");
  const seg = path.split(/[/?#]/).filter(Boolean).pop() ?? "";
  return seg ? `@${seg.replace(/^@/, "")}` : (urlHost(value) ?? value);
}

// Resolve a custom field into a clickable social/website link, or null if the
// field isn't a recognizable social handle.
export function resolveSocial(key: string, rawValue: string): ResolvedSocial | null {
  const value = (rawValue ?? "").trim();
  if (!value) return null;

  const host = urlHost(value);
  // Prefer the key (the platform label) for classification; fall back to the
  // URL host when the key is generic but the value is a recognizable URL.
  let def = PLATFORMS.find((p) => p.keyRe.test(key));
  if (!def && host) def = PLATFORMS.find((p) => p.domainRe?.test(host));
  if (!def) return null;

  if (host) {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return { platform: def.id, label: def.label, icon: def.icon, handle: handleFromUrl(value, def), url };
  }

  const bare = stripHandle(value);
  if (!bare) return null;
  return {
    platform: def.id,
    label: def.label,
    icon: def.icon,
    handle: def.id === "website" ? value : `@${bare}`,
    url: def.build(bare),
  };
}
