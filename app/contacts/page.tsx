"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import type { Contact, ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { computeUpcomingBirthdays, formatBirthday } from "@/lib/birthdays";
import { fileToDataUrl, MAX_IMAGE_DIM, MAX_NOTE_IMAGES } from "@/lib/image";
import { resolveSocial, phoneLinks, findSocial } from "@/lib/socials";
import { uploadVoiceRecording } from "@/lib/voice";
import { isNewConnection } from "@/lib/new-connections";
import { SayHelloButton } from "@/components/SayHelloButton";
import AudioPlayer from "@/components/AudioPlayer";

const TIER_DOT: Record<string, string> = {
  Strong: "bg-green-500",
  Active: "bg-blue-500",
  Fading: "bg-amber-500",
  Dormant: "bg-gray-400",
};

// Deterministic avatar tint per contact, matching the sidebar's palette so the
// same person reads the same color in both views.
const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-red-400",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-teal-500",
];

function avatarColor(name: string): string {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

// How many photos the composer accepts per contact.
const MAX_ATTACHMENTS = 4;

// Cap on photos archived in the immutable creation source (Contact.sourceImages).
// Mirrors LIMITS.sourceImageCount server-side; more generous than a single note
// because the add flow can span several messages.
const MAX_SOURCE_IMAGES = 10;

type Attachment = { name: string; url: string };

// A turn in the composer thread. Audio (a held recording) rides along with the
// turn it was sent in, so it moves into the sent bubble instead of lingering in
// the composer. `url` is an object URL for in-bubble playback; `blob` is kept so
// it can be uploaded to Storage on save.
type ComposerMessage = {
  text: string;
  attachments: Attachment[];
  audio?: { blob: Blob; url: string; name: string | null };
};

// Single-value standard fields we gap-fill when merging into an existing
// contact: only filled when the existing value is empty, never overwritten.
const MERGE_FILL_FIELDS = [
  "email",
  "phone",
  "company",
  "title",
  "location",
  "birthday",
  "howWeMet",
] as const;

const splitTags = (s: string | null | undefined) =>
  (s ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

// Build a non-destructive merge patch: gap-fill empty standard fields, union
// tags (case-insensitively, preserving the existing order), and add new
// custom-field keys without clobbering existing ones. The returned patch only
// carries fields that actually change (plus `name`, which the API requires).
function buildMergePatch(
  existing: Contact,
  incoming: ContactInput
): ContactInput {
  const patch: ContactInput = { name: existing.name };

  for (const f of MERGE_FILL_FIELDS) {
    const next = incoming[f]?.trim();
    if (next && !existing[f]?.trim()) patch[f] = next;
  }

  if (incoming.tags?.trim()) {
    const have = splitTags(existing.tags);
    const seen = new Set(have.map((t) => t.toLowerCase()));
    const merged = [...have];
    for (const t of splitTags(incoming.tags)) {
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        merged.push(t);
      }
    }
    if (merged.length > have.length) patch.tags = merged.join(", ");
  }

  if (incoming.customFields) {
    const cur = existing.customFields ?? {};
    const adders: Record<string, string> = {};
    for (const [k, v] of Object.entries(incoming.customFields)) {
      if (!(k in cur) && v?.trim()) adders[k] = v;
    }
    if (Object.keys(adders).length > 0) {
      patch.customFields = { ...cur, ...adders };
    }
  }

  return patch;
}

// How the contacts list is ordered. Persisted per browser so the choice sticks
// across visits, and shared with the sidebar via a custom event (see below).
type SortMode = "name" | "recent";
const SORT_KEY = "networky:contacts-sort";
const SORT_EVENT = "networky:contacts-sort-change";
// Fired after a contact is created/merged so other views (e.g. the sidebar)
// can refetch even when the route doesn't change. The sidebar listens for it.
const CONTACTS_CHANGED_EVENT = "networky:contacts-changed";

// Compact date like "Jun 17, 2026"; em-dash placeholder when missing/unparseable.
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Date + time like "Jun 17, 2026, 3:45 PM" for columns that want a timestamp.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Bucket contacts into A–Z sections for the grouped table view. Non-letter names
// fall under "#". Aggregates by letter (not adjacency) so each letter is a single
// section regardless of input order, avoiding duplicate React keys.
function groupByInitial(contacts: Contact[]): { letter: string; items: Contact[] }[] {
  const byLetter = new Map<string, Contact[]>();
  for (const c of contacts) {
    const first = (c.name?.trim()?.[0] ?? "#").toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const items = byLetter.get(letter);
    if (items) items.push(c);
    else byLetter.set(letter, [c]);
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([letter, items]) => ({ letter, items }));
}

// ── Table sorting / filtering ───────────────────────────────────────────────

type SortKey =
  | "name"
  | "email"
  | "phone"
  | "howWeMet"
  | "company"
  | "updatedAt"
  | "healthTier"
  | "createdAt";

type ColSort = { key: SortKey; dir: "asc" | "desc" };

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone Number" },
  { key: "howWeMet", label: "Referral" },
  { key: "company", label: "Company" },
  { key: "updatedAt", label: "Last Activity" },
  { key: "healthTier", label: "Relationship" },
  { key: "createdAt", label: "Create Date" },
];

// +1 for the leading selection checkbox column.
const COLUMN_SPAN = COLUMNS.length + 1;

const TIERS = ["Strong", "Active", "Fading", "Dormant"];
const TIER_ORDER: Record<string, number> = { Strong: 0, Active: 1, Fading: 2, Dormant: 3 };

// Glowing relationship pill per tier — soft tinted fill, matching ring, and a
// colored bloom shadow for the "futuristic" feel. Dormant stays neutral.
const TIER_PILL: Record<string, string> = {
  Strong:
    "bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/30 shadow-[0_0_12px_-3px_rgba(34,197,94,0.6)]",
  Active:
    "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30 shadow-[0_0_12px_-3px_rgba(59,130,246,0.6)]",
  Fading:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30 shadow-[0_0_12px_-3px_rgba(245,158,11,0.55)]",
  Dormant: "bg-zinc-400/10 text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-400/30",
};

// Compare two contacts by a column key. String columns sort case-insensitively
// with empties last; date columns by timestamp; relationship by tier strength.
function compareBy(a: Contact, b: Contact, key: SortKey): number {
  if (key === "updatedAt" || key === "createdAt") {
    const ta = new Date(a[key] ?? 0).getTime();
    const tb = new Date(b[key] ?? 0).getTime();
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  }
  if (key === "healthTier") {
    const oa = a.healthTier ? TIER_ORDER[a.healthTier] ?? 99 : 100;
    const ob = b.healthTier ? TIER_ORDER[b.healthTier] ?? 99 : 100;
    return oa - ob;
  }
  const va = (a[key] ?? "") as string;
  const vb = (b[key] ?? "") as string;
  if (!va && vb) return 1;
  if (va && !vb) return -1;
  return va.localeCompare(vb, undefined, { sensitivity: "base" });
}

// Sortable column header — click to cycle asc → desc → unsorted.
function SortHeader({
  col,
  sort,
  onSort,
}: {
  col: { key: SortKey; label: string };
  sort: ColSort | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === col.key;
  return (
    <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left">
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className={`group/sort inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
          active
            ? "text-indigo-600 dark:text-indigo-400"
            : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        }`}
      >
        {col.label}
        <SortArrow dir={active ? sort!.dir : null} />
      </button>
    </th>
  );
}

function SortArrow({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-opacity ${dir ? "opacity-100" : "opacity-0 group-hover/sort:opacity-40"}`}
      aria-hidden
    >
      {dir === "desc" ? <path d="M6 9l6 6 6-6" /> : <path d="M18 15l-6-6-6 6" />}
    </svg>
  );
}

// Pill-style quick-filter chip.
function FilterChip({
  active,
  onClick,
  dot,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}

function Cell({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-4 py-3 text-sm ${
        muted ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-200"
      }`}
    >
      {children}
    </td>
  );
}

const EMPTY = <span className="text-zinc-300 dark:text-zinc-600">—</span>;

// Futuristic checkbox: the native input is hidden (kept for a11y/keyboard) and
// a glowing indigo box with an animated check / indeterminate dash sits on top.
function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={onChange}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border border-zinc-300 bg-white text-white transition-all peer-checked:border-indigo-500 peer-checked:bg-indigo-500 peer-indeterminate:border-indigo-500 peer-indeterminate:bg-indigo-500 peer-checked:shadow-[0_0_11px_-1px_rgba(99,102,241,0.9)] peer-indeterminate:shadow-[0_0_11px_-1px_rgba(99,102,241,0.9)] peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/50 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-white peer-hover:border-indigo-400 dark:border-zinc-600 dark:bg-zinc-800/70 dark:peer-focus-visible:ring-offset-zinc-900"
      >
        {indeterminate ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
            <path d="M6 12h12" />
          </svg>
        ) : (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-all duration-150 ${checked ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
    </label>
  );
}

// One contact as a table row. The whole name cell links to the detail page;
// email/phone are their own mailto/tel links. A leading checkbox selects the row.
function ContactRow({
  c,
  selected,
  onToggle,
}: {
  c: Contact;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const initial = (c.name?.[0] ?? "?").toUpperCase();
  return (
    <tr
      className={`group/row border-b border-zinc-100 transition-colors last:border-0 dark:border-zinc-800/60 ${
        selected
          ? "bg-indigo-50/70 dark:bg-indigo-500/10"
          : "hover:bg-zinc-50 dark:hover:bg-indigo-500/[0.05]"
      }`}
    >
      <td className="relative w-10 px-4 py-3">
        <span
          className={`absolute left-0 top-0 h-full w-0.5 bg-indigo-500 transition-opacity dark:shadow-[0_0_10px_rgba(99,102,241,0.9)] ${
            selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-70"
          }`}
        />
        <Checkbox
          checked={selected}
          onChange={() => onToggle(c.id)}
          ariaLabel={`Select ${c.name}`}
        />
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href={`/contacts/${c.id}`} className="group flex min-w-0 items-center gap-3">
            <span
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ring-1 ring-black/5 transition-all group-hover/row:ring-2 group-hover/row:ring-indigo-400/60 group-hover/row:shadow-[0_0_16px_-2px_rgba(99,102,241,0.75)] dark:ring-white/10 ${avatarColor(
                c.name ?? ""
              )}`}
            >
              {initial}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-zinc-900 group-hover:text-indigo-700 group-hover:underline dark:text-zinc-100 dark:group-hover:text-indigo-300">
                  {c.name}
                </span>
                {c.profile && (
                  <span className="flex-shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
                    AI
                  </span>
                )}
              </span>
              {c.title && (
                <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                  {c.title}
                </span>
              )}
            </span>
          </Link>
          {isNewConnection(c.createdAt) && (
            <SayHelloButton
              contactId={c.id}
              contactName={c.name}
              contactEmail={c.email}
              label="Say hello"
              className="flex-shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white opacity-0 transition-opacity hover:bg-indigo-700 group-hover/row:opacity-100 focus-visible:opacity-100"
            />
          )}
        </div>
      </td>

      <Cell>
        {c.email ? (
          <a href={`mailto:${c.email}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            {c.email}
          </a>
        ) : (
          EMPTY
        )}
      </Cell>

      <Cell>
        {c.phone ? (
          <a href={`tel:${c.phone}`} className="hover:underline">
            {c.phone}
          </a>
        ) : (
          EMPTY
        )}
      </Cell>

      <Cell>
        {c.howWeMet ? (
          <span className="block max-w-[16rem] truncate" title={c.howWeMet}>
            {c.howWeMet}
          </span>
        ) : (
          EMPTY
        )}
      </Cell>

      <Cell>{c.company || EMPTY}</Cell>

      <Cell muted>{formatDate(c.updatedAt)}</Cell>

      <Cell>
        {c.healthTier ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              TIER_PILL[c.healthTier] ?? TIER_PILL.Dormant
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${TIER_DOT[c.healthTier] ?? "bg-gray-400"}`} />
            {c.healthTier}
          </span>
        ) : (
          EMPTY
        )}
      </Cell>

      <Cell muted>{formatDateTime(c.createdAt)}</Cell>
    </tr>
  );
}

// Full-width contacts table. Scrolls within its own region (sticky header stays
// pinned) and horizontally on narrow viewports. When `grouped` (A–Z sort, no
// active column sort), rows are bucketed under letter header rows.
function ContactsTable({
  contacts,
  grouped,
  sort,
  onSort,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  contacts: Contact[];
  grouped: boolean;
  sort: ColSort | null;
  onSort: (key: SortKey) => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const allSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const someSelected = contacts.some((c) => selectedIds.has(c.id));

  return (
    <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-indigo-500/15 dark:bg-gradient-to-b dark:from-zinc-900 dark:to-zinc-950 dark:shadow-[0_0_0_1px_rgba(99,102,241,0.06),0_24px_70px_-24px_rgba(79,70,229,0.4)]">
      <table className="w-full min-w-[1040px] border-collapse">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-md dark:border-indigo-500/20 dark:bg-zinc-950/80 dark:shadow-[0_1px_0_0_rgba(99,102,241,0.15)]">
            <th className="w-10 px-4 py-2.5">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onChange={onToggleAll}
                ariaLabel="Select all contacts"
              />
            </th>
            {COLUMNS.map((col) => (
              <SortHeader key={col.key} col={col} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped
            ? groupByInitial(contacts).map((group) => (
                <Fragment key={group.letter}>
                  <tr className="border-y border-zinc-100 bg-zinc-50/70 dark:border-indigo-500/10 dark:bg-indigo-500/[0.04]">
                    <td colSpan={COLUMN_SPAN} className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-3 w-0.5 rounded-full bg-indigo-500 dark:shadow-[0_0_8px_rgba(99,102,241,0.85)]" />
                        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-500 dark:text-indigo-400">
                          {group.letter}
                        </span>
                      </span>
                    </td>
                  </tr>
                  {group.items.map((c) => (
                    <ContactRow
                      key={c.id}
                      c={c}
                      selected={selectedIds.has(c.id)}
                      onToggle={onToggle}
                    />
                  ))}
                </Fragment>
              ))
            : contacts.map((c) => (
                <ContactRow
                  key={c.id}
                  c={c}
                  selected={selectedIds.has(c.id)}
                  onToggle={onToggle}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}

// One-click copy for a chat bubble's text — saves selecting it by hand. Falls
// back to a hidden <textarea> + execCommand when the async Clipboard API is
// unavailable (older browsers / non-secure contexts). Briefly flips to a check.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* clipboard unavailable — nothing more we can do */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : "Copy text"}
      aria-label={copied ? "Copied" : "Copy message text"}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-indigo-100 transition-colors hover:bg-white/15 hover:text-white"
    >
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Table interactions: per-column sort, row selection, and quick filters.
  // These all operate over the currently-loaded contacts (client-side).
  const [colSort, setColSort] = useState<ColSort | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [extracted, setExtracted] = useState<ContactInput | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [story, setStory] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [enrich, setEnrich] = useState(true);
  const [enrichedKeys, setEnrichedKeys] = useState<string[]>([]);
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  // "low" when enrichment matched on the name alone (no corroborating context),
  // so the UI can warn the user to confirm it's the right person.
  const [enrichConfidence, setEnrichConfidence] = useState<
    "high" | "low" | undefined
  >(undefined);
  // The composer runs as a chat session: each story you send becomes a bubble
  // in this thread, and the whole thread is re-analyzed on every send so the
  // contact refines as you keep adding details.
  const [messages, setMessages] = useState<ComposerMessage[]>([]);
  const [showExtractToast, setShowExtractToast] = useState(false);
  // Final review modal shown before a contact is actually saved.
  const [showSaveReview, setShowSaveReview] = useState(false);
  const [inputTruncated, setInputTruncated] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Composer attachments (photos) + the "+" attach menu.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Upload a pre-recorded audio file → server-side transcript → composer. Lets
  // you dictate offline on a phone recorder and add the contact later online.
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [transcribing, setTranscribing] = useState(false);
  // Keep the uploaded recording itself (not just its transcript) so you can play
  // it back here in the composer, and so it gets attached — with playback — to
  // the contact's first note on save. The blob is held in memory and only
  // uploaded to Storage once a contact id exists (see attachStoryNote); the
  // object URL is purely for local preview. `audioName` labels the player.
  const [pendingAudio, setPendingAudio] = useState<Blob | null>(null);
  const [pendingAudioUrl, setPendingAudioUrl] = useState<string | null>(null);
  const [pendingAudioName, setPendingAudioName] = useState<string | null>(null);

  // Live-camera capture ("Take photo").
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Word-scanning animation state. While analyzing, scan the words of the
  // message that was just sent (it's left the composer and is now a bubble).
  const [scanIndex, setScanIndex] = useState(0);
  const scanText =
    extracting && messages.length > 0 ? messages[messages.length - 1].text : story;
  const storyTokens = useMemo(() => scanText.split(/(\s+)/).filter(Boolean), [scanText]);
  const tokenWordIndices = useMemo(() => {
    let w = 0;
    return storyTokens.map(t => (t.trim() ? w++ : -1));
  }, [storyTokens]);
  const wordCount = useMemo(() => storyTokens.filter(t => t.trim()).length, [storyTokens]);

  useEffect(() => {
    if (!extracting) { setScanIndex(0); return; }
    const id = setInterval(() => setScanIndex(i => (i + 1) % Math.max(1, wordCount)), 100);
    return () => clearInterval(id);
  }, [extracting, wordCount]);

  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) => setStory((t) => (t ? `${t} ${text}` : text)),
  });

  // Close the attach menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) return;
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, room);
    try {
      const next = await Promise.all(
        picked.map(async (f) => ({ name: f.name, url: await fileToDataUrl(f) }))
      );
      setAttachments((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
    } catch {
      setExtractError("Couldn't read one of those images — try a different file.");
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  // Replace the held recording, revoking the previous preview URL so we don't
  // leak object URLs when several recordings are uploaded in one session.
  function setRecording(file: File | null) {
    setPendingAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setPendingAudio(file);
    setPendingAudioName(file?.name ?? null);
  }

  // Transcribe an uploaded recording and append the text to the composer, the
  // same place live dictation lands — then you review and send as usual. We also
  // keep the audio itself so you can play it back below and it gets attached to
  // the contact's first note on save.
  async function handleAudioFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setMenuOpen(false);
    setExtractError(null);
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        setExtractError(
          error ||
            (res.status === 429
              ? "You're going a bit fast — please wait a moment and try again."
              : "Couldn't transcribe that recording — try again.")
        );
        return;
      }
      const { text } = (await res.json()) as { text?: string };
      const transcript = (text ?? "").trim();
      if (!transcript) {
        setExtractError("No speech was detected in that recording.");
        return;
      }
      setStory((t) => (t ? `${t} ${transcript}` : transcript));
      // Hold the recording for playback + attachment now that we know it
      // contained usable speech.
      setRecording(file);
    } catch {
      setExtractError("Couldn't transcribe that recording — try again.");
    } finally {
      setTranscribing(false);
    }
  }

  // Open the live camera modal (works on desktop + mobile via getUserMedia).
  function openCamera() {
    setMenuOpen(false);
    if (attachments.length >= MAX_ATTACHMENTS) return;
    setCameraError(null);
    setCameraOpen(true);
  }

  // Acquire/tear down the camera stream while the modal is open.
  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setCameraError("This browser can't access a camera. Use “Add photos” instead.");
      return;
    }
    media
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError(
            "Couldn't access the camera — check the browser permission, or use “Add photos” instead."
          );
        }
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [cameraOpen]);

  // Snapshot the current video frame into an attachment, downscaling to match
  // uploaded photos, then close the camera.
  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(
      1,
      MAX_IMAGE_DIM / Math.max(video.videoWidth, video.videoHeight)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    setAttachments((prev) =>
      [...prev, { name: `photo-${prev.length + 1}.jpg`, url }].slice(0, MAX_ATTACHMENTS)
    );
    setCameraOpen(false);
  }

  async function handleExtract() {
    const text = story.trim();
    const draftAttachments = attachments;
    if (!text && draftAttachments.length === 0) return;

    // Add this turn to the conversation, clear the composer, then re-analyze
    // the whole thread so the AI has the full context of everything you've sent.
    // A held recording rides along with this turn so it moves into the sent
    // bubble; we transfer ownership of its object URL (clear the composer state
    // WITHOUT revoking it, unlike setRecording(null)).
    const audio =
      pendingAudio && pendingAudioUrl
        ? { blob: pendingAudio, url: pendingAudioUrl, name: pendingAudioName }
        : undefined;
    const thread = [...messages, { text, attachments: draftAttachments, audio }];
    setMessages(thread);
    setStory("");
    setAttachments([]);
    setPendingAudio(null);
    setPendingAudioUrl(null);
    setPendingAudioName(null);
    setMenuOpen(false);
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/contacts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: thread.map((m) => m.text).filter(Boolean).join("\n\n"),
          enrich,
          images: thread.flatMap((m) => m.attachments.map((a) => a.url)),
        }),
      });
      if (!res.ok) {
        setExtractError(
          res.status === 429
            ? "You're going a bit fast — please wait a moment and try again."
            : "Couldn't extract details — try rephrasing or extracting again."
        );
        return;
      }
      const {
        fields,
        enriched,
        sources: srcs,
        confidence,
        truncated,
      } = (await res.json()) as {
        fields: ContactInput;
        enriched?: string[];
        sources?: { title: string; url: string }[];
        confidence?: "high" | "low";
        truncated?: boolean;
      };
      setInputTruncated(truncated === true);
      // Normalise all field values to strings to guard against LLM returning arrays/numbers
      const safe: ContactInput = {
        name: String(fields.name ?? ""),
        title: fields.title ? String(fields.title) : undefined,
        company: fields.company ? String(fields.company) : undefined,
        email: fields.email ? String(fields.email) : undefined,
        phone: fields.phone ? String(fields.phone) : undefined,
        location: fields.location ? String(fields.location) : undefined,
        tags: fields.tags ? String(fields.tags) : undefined,
        howWeMet: fields.howWeMet ? String(fields.howWeMet) : undefined,
        birthday: fields.birthday ? String(fields.birthday) : undefined,
        customFields:
          fields.customFields && Object.keys(fields.customFields).length > 0
            ? fields.customFields
            : undefined,
      };
      setExtracted(safe);
      setEnrichedKeys(
        Array.isArray(enriched)
          ? enriched.filter((k) => k in (safe.customFields ?? {}))
          : []
      );
      setSources(Array.isArray(srcs) ? srcs : []);
      setEnrichConfidence(confidence);
      setExtractError(null);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setShowExtractToast(true);
      toastTimer.current = setTimeout(() => setShowExtractToast(false), 4000);
    } finally {
      setExtracting(false);
    }
  }

  function resetForm() {
    setStory("");
    setRecording(null);
    // Release any object URLs held by sent-message recordings before dropping
    // the thread, so we don't leak them across resets.
    messages.forEach((m) => {
      if (m.audio) URL.revokeObjectURL(m.audio.url);
    });
    setMessages([]);
    setExtracted(null);
    setExtractError(null);
    setEnrichedKeys([]);
    setSources([]);
    setEnrichConfidence(undefined);
    setInputTruncated(false);
    setAttachments([]);
    setMenuOpen(false);
    setShowSaveReview(false);
  }

  // One page of the grid. Search runs server-side via `q`; results are paged.
  const PAGE_SIZE = 24;

  const fetchPage = useCallback(
    async (q: string, offset: number) => {
      const res = await fetch(
        `/api/contacts?q=${encodeURIComponent(q)}&sort=${sort}&limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Contact[];
      const more = res.headers.get("X-Has-More") === "true";
      const total = Number(res.headers.get("X-Total-Count") ?? NaN);
      return { data, more, total: isNaN(total) ? null : total };
    },
    [sort]
  );

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data, more, total } = await fetchPage(q, 0);
        setContacts(data);
        setHasMore(more);
        if (total !== null) setTotalCount(total);
        setSelected(new Set());
      } catch {
        setContacts([]);
        setHasMore(false);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [fetchPage]
  );

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const { data, more } = await fetchPage(query, contacts.length);
      setContacts((prev) => [...prev, ...data]);
      setHasMore(more);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, query, contacts.length]);

  // Seed the search box from a `?q=` param so dashboard deep-links (company /
  // tag pills) land here pre-filtered. Read once on mount; we use
  // window.location instead of useSearchParams to avoid a Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
  }, []);

  // Restore the saved sort preference on mount.
  useEffect(() => {
    const saved = localStorage.getItem(SORT_KEY);
    if (saved === "name" || saved === "recent") setSort(saved);
  }, []);

  // Persist the choice and tell the sidebar so the two views stay in sync.
  // Picking A–Z / Recent also clears any active column sort so the toggle takes
  // effect (and A–Z grouping can resume).
  function changeSort(next: SortMode) {
    setSort(next);
    setColSort(null);
    localStorage.setItem(SORT_KEY, next);
    window.dispatchEvent(new CustomEvent(SORT_EVENT, { detail: next }));
  }

  // Click a column header: cycle asc → desc → unsorted (back to A–Z/Recent).
  function handleColSort(key: SortKey) {
    setColSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  // Tags present across the loaded contacts, for the quick-filter chips.
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) for (const t of splitTags(c.tags)) s.add(t);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  // The rows actually shown: loaded contacts narrowed by the quick filters and
  // (when a column header is active) re-sorted client-side.
  const visible = useMemo(() => {
    let list = contacts;
    if (tierFilter) list = list.filter((c) => c.healthTier === tierFilter);
    if (tagFilter)
      list = list.filter((c) =>
        splitTags(c.tags).some((t) => t.toLowerCase() === tagFilter.toLowerCase())
      );
    if (colSort) {
      const dir = colSort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => compareBy(a, b, colSort.key) * dir);
    }
    return list;
  }, [contacts, tierFilter, tagFilter, colSort]);

  // Group under A–Z letters only in the default name order (no column sort).
  const grouped = !colSort && sort === "name";

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Select-all: if there are more pages, load them all first so every contact
  // is covered. Then toggle selection over the visible (filtered) set.
  const toggleSelectAll = useCallback(async () => {
    let allContacts = contacts;
    if (hasMore) {
      let accumulated = [...contacts];
      let offset = contacts.length;
      let more = true;
      while (more) {
        const { data, more: nextMore } = await fetchPage(query, offset);
        accumulated = [...accumulated, ...data];
        offset += data.length;
        more = nextMore;
      }
      setContacts(accumulated);
      setHasMore(false);
      allContacts = accumulated;
    }
    const ids = allContacts
      .filter((c) => !tierFilter || c.healthTier === tierFilter)
      .filter((c) => !tagFilter || splitTags(c.tags).some((t) => t.toLowerCase() === tagFilter.toLowerCase()))
      .map((c) => c.id);
    setSelected((prev) => {
      const allSel = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, [contacts, hasMore, fetchPage, query, tierFilter, tagFilter]);

  const clearSelection = () => setSelected(new Set());

  const clearFilters = () => {
    setTierFilter(null);
    setTagFilter(null);
    setColSort(null);
  };

  // ── Bulk actions over the current selection ────────────────────────────────
  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    const res = await Swal.fire({
      icon: "warning",
      title: `Delete ${ids.length} contact${ids.length === 1 ? "" : "s"}?`,
      html: `This permanently removes them and their notes. This can't be undone.<br/><br/>Type <strong>delete</strong> to confirm.`,
      input: "text",
      inputPlaceholder: "delete",
      inputAttributes: { autocomplete: "off", spellcheck: "false" },
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#dc2626",
      cancelButtonText: "Cancel",
      preConfirm: (value: string) => {
        if (value.trim().toLowerCase() !== "delete") {
          Swal.showValidationMessage('Type "delete" to confirm');
          return false;
        }
        return true;
      },
    });
    if (!res.isConfirmed) return;
    setBulkBusy(true);
    Swal.fire({
      title: `Deleting ${ids.length} contact${ids.length === 1 ? "" : "s"}…`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      await Promise.all(ids.map((id) => fetch(`/api/contacts/${id}`, { method: "DELETE" })));
      clearSelection();
      await load(query);
      window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT));
      Swal.fire({ icon: "success", title: "Deleted", timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: "error", title: "Delete failed", text: "Some contacts couldn't be deleted." });
    } finally {
      setBulkBusy(false);
    }
  }

  // Download the selected contacts as a CSV (client-side, no server round-trip).
  function bulkExport() {
    const rows = visible.filter((c) => selected.has(c.id));
    if (!rows.length) return;
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Referral",
      "Company",
      "Title",
      "Relationship",
      "Created",
      "Last Activity",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      headers.join(","),
      ...rows.map((c) =>
        [c.name, c.email, c.phone, c.howWeMet, c.company, c.title, c.healthTier, c.createdAt, c.updatedAt]
          .map(esc)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `networky-contacts-${rows.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Add a tag to every selected contact (skips ones that already have it).
  async function bulkTag() {
    const ids = [...selected];
    if (!ids.length) return;
    const { value: input } = await Swal.fire({
      title: `Add a tag to ${ids.length} contact${ids.length === 1 ? "" : "s"}`,
      input: "text",
      inputPlaceholder: "e.g. investor",
      showCancelButton: true,
      confirmButtonText: "Add tag",
      confirmButtonColor: "#4f46e5",
      inputValidator: (v) => (!v?.trim() ? "Enter a tag" : undefined),
    });
    const tag = (input ?? "").trim();
    if (!tag) return;
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) => {
          const c = contacts.find((x) => x.id === id);
          if (!c) return Promise.resolve();
          const have = splitTags(c.tags);
          if (have.some((t) => t.toLowerCase() === tag.toLowerCase())) return Promise.resolve();
          return fetch(`/api/contacts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: c.name, tags: [...have, tag].join(", ") }),
          });
        })
      );
      clearSelection();
      await load(query);
      window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT));
    } catch {
      Swal.fire({ icon: "error", title: "Couldn't add tag", text: "Please try again." });
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(query), 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, load]);

  // Reconstruct the full creation input from the chat-style composer: it moves
  // every sent message into `messages` and clears `story`, so the raw record is
  // the whole thread (plus any text/photos typed but never sent). Text is capped
  // to the server's noteContent/sourceText limit; images are returned uncapped
  // and each caller slices to its own limit.
  function buildRawSource() {
    const text = [...messages.map((m) => m.text), story]
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 20000);
    const images = [
      ...messages.flatMap((m) => m.attachments.map((a) => a.url)),
      ...attachments.map((a) => a.url),
    ];
    return { text, images };
  }

  // Preserve the creation conversation as an editable note, so each contact
  // keeps a working record of what it was created from. Stays "story"-sourced so
  // it gets the 📖 badge in the notes list.
  async function attachStoryNote(contactId: string) {
    const { text, images } = buildRawSource();
    const noteImages = images.slice(0, MAX_NOTE_IMAGES);
    // Upload the recording (if any) now that we have a contact id to file it
    // under — taking it from the first message that carries one, or the
    // still-in-composer recording if nothing was sent. Best-effort: returns null
    // when Storage isn't configured or the upload fails, in which case the note
    // keeps its transcript text only. (A note holds one audioUrl; the typical
    // flow is a single recording.)
    const audioBlob = messages.find((m) => m.audio)?.audio?.blob ?? pendingAudio;
    const audioUrl = audioBlob
      ? await uploadVoiceRecording(audioBlob, contactId)
      : null;
    if (!text && noteImages.length === 0 && !audioUrl) return;
    await fetch(`/api/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: text,
        source: "story",
        images: noteImages,
        audioUrl,
      }),
    });
  }

  // Create a brand-new contact (the original save path).
  async function createNewContact(input: ContactInput) {
    Swal.fire({
      title: "Saving Contact...",
      html: `<p style="font-size:0.875rem">Adding <strong>${input.name}</strong> to your network</p>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    // Archive the original input on the contact itself (immutable), alongside
    // the editable story note. This is the safety net for a future
    // re-analyze/reset — it survives even if the note is edited or deleted.
    const { text: sourceText, images } = buildRawSource();
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        sourceText: sourceText || undefined,
        sourceImages: images.slice(0, MAX_SOURCE_IMAGES),
      }),
    });
    if (!res.ok) {
      // Surface the server's validation reason (e.g. "email is not a valid
      // address") so the user can fix the offending field, instead of a generic
      // "something went wrong".
      const { error } = await res.json().catch(() => ({ error: "" }));
      throw new Error(error || `Couldn't save contact (HTTP ${res.status}).`);
    }
    const contact = (await res.json()) as { id: string };
    await attachStoryNote(contact.id);
    Swal.fire({
      icon: "success",
      title: "Contact Saved!",
      html: `<p style="font-size:0.875rem"><strong>${input.name}</strong> has been added to your network.</p>`,
      timer: 2000,
      timerProgressBar: true,
      showConfirmButton: false,
    });
    resetForm();
    setShowForm(false);
    // Clear any active search and force a reload so the new contact shows up
    // immediately. setQuery("") alone is a no-op when the box is already empty,
    // so the debounced load wouldn't re-fire — reload explicitly.
    setQuery("");
    await load("");
    // Tell the sidebar (which only refetches on navigation) to refresh too,
    // since creating a contact keeps us on the same route.
    window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT));
  }

  // Non-destructively merge the extracted details into an existing contact,
  // then open that contact.
  async function mergeIntoExisting(existing: Contact, input: ContactInput) {
    Swal.fire({
      title: "Merging...",
      html: `<p style="font-size:0.875rem">Updating <strong>${existing.name}</strong></p>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    const patch = buildMergePatch(existing, input);
    const res = await fetch(`/api/contacts/${existing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "" }));
      throw new Error(error || `Couldn't update contact (HTTP ${res.status}).`);
    }
    await attachStoryNote(existing.id);
    resetForm();
    setShowForm(false);
    router.push(`/contacts/${existing.id}`);
  }

  async function handleSave() {
    if (!extracted?.name?.trim()) return;
    const input = extracted;
    setSaving(true);
    try {
      // Look for likely duplicates (case-insensitive exact name/email) before
      // creating a new record. A failed check shouldn't block saving.
      const params = new URLSearchParams({ name: input.name.trim() });
      if (input.email?.trim()) params.set("email", input.email.trim());
      let dupes: Contact[] = [];
      try {
        const checkRes = await fetch(`/api/contacts/check?${params}`);
        if (checkRes.ok) dupes = (await checkRes.json()) as Contact[];
      } catch {
        /* network blip on the check — fall through to a normal create */
      }

      if (dupes.length > 0) {
        const existing = dupes[0];
        const subtitle = [existing.title, existing.company]
          .filter(Boolean)
          .join(" · ");
        const choice = await Swal.fire({
          icon: "question",
          title: "Possible duplicate",
          html: `<p style="font-size:0.875rem">A contact named <strong>${existing.name}</strong>${
            subtitle ? ` (${subtitle})` : ""
          } already exists. Merge the new details into it, or save as a separate contact?</p>`,
          showDenyButton: true,
          showCancelButton: true,
          confirmButtonText: "Merge",
          denyButtonText: "Save as new",
          cancelButtonText: "Cancel",
          confirmButtonColor: "#4f46e5",
          denyButtonColor: "#52525b",
        });
        if (choice.isConfirmed) {
          await mergeIntoExisting(existing, input);
        } else if (choice.isDenied) {
          await createNewContact(input);
        }
        // Cancel/dismiss → leave the form as-is so nothing is lost.
        return;
      }

      await createNewContact(input);
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Save Failed",
        text:
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:text-indigo-600"
      >
        <span aria-hidden>←</span> Back to dashboard
      </Link>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            {totalCount !== null && (
              <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-sm font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
                {totalCount}
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Your professional network, enriched with AI.
          </p>
        </div>
        <button
          onClick={() => {
            if (showForm) resetForm();
            setShowForm((s) => !s);
          }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {showForm ? "Cancel" : "+ Add contact"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/30 p-5">
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            ✨ Add contact
          </h2>

          {/* Sent messages — each story you send becomes a bubble here, above
              the composer. The extracted result card renders below the input. */}
          {(messages.length > 0 || extracting) && (
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div key={i} className="flex justify-end">
                  <div className="group flex max-w-[85%] flex-col gap-2 rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 text-sm text-white shadow-sm">
                    {m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.attachments.map((a, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={j}
                            src={a.url}
                            alt={a.name}
                            className="h-12 w-12 rounded-md object-cover ring-1 ring-white/30"
                          />
                        ))}
                      </div>
                    )}
                    {m.text ? (
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {m.text}
                      </p>
                    ) : !m.audio ? (
                      <p className="italic text-indigo-100">
                        Sent {m.attachments.length} photo
                        {m.attachments.length === 1 ? "" : "s"}
                      </p>
                    ) : null}
                    {m.audio && (
                      <div className="rounded-xl bg-indigo-500/40 px-2.5 py-2 ring-1 ring-white/15">
                        <AudioPlayer
                          src={m.audio.url}
                          label={m.audio.name ?? undefined}
                          tone="accent"
                        />
                      </div>
                    )}
                    {m.text && (
                      <div className="-mb-1 flex justify-end">
                        <CopyButton text={m.text} />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Assistant "thinking" — scans your latest message word by word */}
              {extracting && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm">
                    <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                      Analyzing…
                    </div>
                    <div
                      className="text-sm text-zinc-700 dark:text-zinc-200"
                      style={{ lineHeight: "1.6", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                      aria-live="polite"
                    >
                      {storyTokens.map((token, idx) => {
                        const wIdx = tokenWordIndices[idx];
                        if (wIdx === -1) return <span key={idx}>{token}</span>;
                        const active = wIdx === scanIndex;
                        return (
                          <span
                            key={idx}
                            style={{
                              backgroundColor: active ? "rgba(99,102,241,0.15)" : undefined,
                              color: active ? "rgb(79,70,229)" : undefined,
                              fontWeight: active ? 600 : undefined,
                              borderRadius: "3px",
                              transition: "background-color 0.08s, color 0.08s",
                            }}
                          >
                            {token}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {extractError && (
            <p className="text-xs text-red-600 dark:text-red-400">{extractError}</p>
          )}

          {/* Claude-style composer: photo thumbnails + textarea, with a toolbar
              (attach menu, mic, send) docked along the bottom edge. Stays open
              the whole session so you can keep sending follow-up messages. */}
          <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 pb-0">
                {attachments.map((a, i) => (
                  <div key={i} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={a.name}
                      className="h-16 w-16 rounded-lg border border-zinc-200 dark:border-zinc-800 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      title="Remove image"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[10px] leading-none text-white shadow transition-colors hover:bg-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleExtract();
                }
              }}
              onPaste={(e) => {
                // Let an image copied to the clipboard (e.g. a screenshot, or
                // "Copy image" from a browser) drop straight into the composer
                // as an attachment — same path as the file picker. Plain-text
                // pastes fall through to the default textarea behaviour.
                const files = e.clipboardData?.files;
                if (
                  files?.length &&
                  Array.from(files).some((f) => f.type.startsWith("image/"))
                ) {
                  e.preventDefault();
                  handleFiles(files);
                }
              }}
              disabled={extracting || transcribing}
              placeholder={
                transcribing
                  ? "Transcribing your recording…"
                  : messages.length > 0
                  ? "Add more details, or correct something…"
                  : "Tell me about this person — how you met, what they do, where they work…"
              }
              rows={3}
              className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-0 disabled:opacity-50"
            />

            {/* Uploaded recording — play it back here; it's attached to the
                contact's first note (with its transcript) when you save. */}
            {pendingAudioUrl && (
              <div className="relative mx-3 mb-1 overflow-hidden rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-violet-500/5 to-transparent px-3 py-2.5 shadow-[inset_0_0_20px_rgba(99,102,241,0.08)]">
                <AudioPlayer
                  src={pendingAudioUrl}
                  label={pendingAudioName ?? undefined}
                  onRemove={() => setRecording(null)}
                />
              </div>
            )}

            {/* Toolbar: + attach · mic · (clear) · send */}
            <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  disabled={extracting || transcribing}
                  title="Add photos & files"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 dark:border-zinc-700 text-xl leading-none text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                >
                  +
                </button>
                {menuOpen && (
                  <div className="absolute bottom-10 left-0 z-10 w-52 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <span aria-hidden>📎</span> Add photos &amp; files
                    </button>
                    <button
                      type="button"
                      onClick={openCamera}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <span aria-hidden>📷</span> Take photo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        audioInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <span aria-hidden>🎙️</span> Upload recording
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={toggle}
                disabled={!supported || extracting || transcribing}
                title={
                  supported
                    ? "Dictate with speech-to-text"
                    : "Speech recognition not supported in this browser (try Chrome)"
                }
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                  listening
                    ? "bg-red-600 text-white"
                    : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-40"
                }`}
              >
                {listening ? "● Listening… stop" : "🎤"}
              </button>

              {transcribing && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400/40 border-t-zinc-500" />
                  Transcribing…
                </span>
              )}

              <div className="ml-auto flex items-center gap-2">
                {!extracting &&
                  (story.trim() ||
                    attachments.length > 0 ||
                    messages.length > 0 ||
                    extracted) && (
                    <button
                      type="button"
                      onClick={resetForm}
                      title="Start over — clears the whole conversation"
                      className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      {messages.length > 0 ? "New" : "Clear"}
                    </button>
                  )}
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={extracting || transcribing || (!story.trim() && attachments.length === 0)}
                  title={messages.length > 0 ? "Send" : "Analyze story"}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                >
                  {extracting ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                handleAudioFile(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={enrich}
              onChange={(e) => setEnrich(e.target.checked)}
              className="mt-0.5 accent-indigo-600"
            />
            <span>
              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                🌐 Enrich from the web
              </span>
              <span className="block text-zinc-400 dark:text-zinc-500">
                Searches the public web for this person, then falls back to a
                professional-data lookup for people with a limited web presence,
                and adds cited details — role, bio, interests. May be outdated;
                verify before trusting. Never collects private email, phone, or
                home address.
              </span>
            </span>
          </label>

          {/* Extracted result — renders below the composer */}
          {extracted && !extracting && (
            <div className="space-y-3">
              <ExtractedCard
                extracted={extracted}
                enrichedKeys={enrichedKeys}
                sources={sources}
                lowConfidence={enrichConfidence === "low"}
                onUpdate={setExtracted}
              />
              <button
                type="button"
                onClick={() => setShowSaveReview(true)}
                disabled={saving || !extracted.name?.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save contact"}
              </button>
            </div>
          )}
        </div>
      )}

      <UpcomingBirthdays contacts={contacts} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, company, title, tag…"
          className="input w-full"
        />
        <div className="flex shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-0.5 text-sm">
          {(
            [
              ["name", "A–Z"],
              ["recent", "Recent"],
            ] as [SortMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => changeSort(mode)}
              aria-pressed={sort === mode}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                sort === mode
                  ? "bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!loading && !loadError && contacts.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Relationship</span>
          <FilterChip active={tierFilter === null} onClick={() => setTierFilter(null)}>
            All
          </FilterChip>
          {TIERS.map((t) => (
            <FilterChip
              key={t}
              active={tierFilter === t}
              onClick={() => setTierFilter(tierFilter === t ? null : t)}
              dot={TIER_DOT[t]}
            >
              {t}
            </FilterChip>
          ))}

          {allTags.length > 0 && (
            <>
              <span className="ml-2 text-xs font-medium text-zinc-400 dark:text-zinc-500">Tag</span>
              {tagFilter ? (
                <FilterChip active onClick={() => setTagFilter(null)}>
                  {tagFilter} ✕
                </FilterChip>
              ) : (
                allTags.slice(0, 8).map((tag) => (
                  <FilterChip key={tag} onClick={() => setTagFilter(tag)}>
                    {tag}
                  </FilterChip>
                ))
              )}
            </>
          )}

          {(tierFilter || tagFilter || colSort) && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400"
            >
              Clear all
            </button>
          )}

          <span className="ml-auto text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
            Showing {visible.length} of {contacts.length}
            {hasMore ? "+" : ""}
          </span>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : loadError && contacts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load contacts — check your connection.
          </p>
          <button
            onClick={() => load(query)}
            className="mt-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Retry
          </button>
        </div>
      ) : contacts.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">
          {query
            ? "No contacts match your search."
            : "No contacts yet. Add your first one above."}
        </p>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No contacts match the current filters.
          </p>
          <button
            onClick={clearFilters}
            className="mt-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ContactsTable
          contacts={visible}
          grouped={grouped}
          sort={colSort}
          onSort={handleColSort}
          selectedIds={selected}
          onToggle={toggleSelect}
          onToggleAll={toggleSelectAll}
        />
      )}

      {!loading && hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {/* Floating bulk-action bar — appears while rows are selected */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div
            className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{ boxShadow: "0 12px 44px -10px rgba(99,102,241,0.4), 0 4px 14px -4px rgba(0,0,0,0.25)" }}
          >
            <span className="px-2 text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-100">
              {selected.size} selected
            </span>
            <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            <button
              type="button"
              onClick={bulkTag}
              disabled={bulkBusy}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              + Tag
            </button>
            <button
              type="button"
              onClick={bulkExport}
              disabled={bulkBusy}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={bulkDelete}
              disabled={bulkBusy}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              {bulkBusy ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="ml-1 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Extraction success toast */}
      {showExtractToast && (
        <div className="toast-enter pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
          <div
            className="relative flex w-full max-w-sm items-start gap-3.5 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-white dark:bg-zinc-900 p-4 pb-5"
            style={{ boxShadow: "0 12px 40px -8px rgba(99,102,241,0.28), 0 4px 16px -4px rgba(0,0,0,0.10)" }}
          >
            {/* Check icon */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Got it!</p>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Review the fields, send another message to add or correct details, or save when it looks right.
              </p>
              {inputTruncated && (
                <p className="mt-1.5 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                  Your text was long, so only the beginning was analyzed. Double-check nothing important was missed.
                </p>
              )}
            </div>
            {/* Progress bar */}
            <div className="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full">
              <div
                className="h-full bg-indigo-400 rounded-full"
                style={{ animation: "toast-bar-shrink 4s linear forwards", transformOrigin: "left" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Review & confirm modal — final check before the contact is saved */}
      {showSaveReview && extracted && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 15, 30, 0.55)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowSaveReview(false)}
        >
          <div
            className="modal-card flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 64px -12px rgba(99,102,241,0.22), 0 8px 24px -4px rgba(0,0,0,0.12)" }}
          >
            {/* Header */}
            <div className="border-b border-zinc-100 dark:border-zinc-800 px-6 pb-4 pt-6">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Review &amp; confirm
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                Double-check the details below before adding this contact.
              </p>
            </div>

            {/* Scrollable details */}
            <div className="flex-1 space-y-3.5 overflow-y-auto px-6 py-4">
              {(() => {
                const customEntries = Object.entries(extracted.customFields ?? {});
                return (
                  <>
                    <ReviewRow label="Name" value={extracted.name} />
                    {FIELD_DEFS.map((f) => {
                      const v = extracted[f.key];
                      if (!v || typeof v !== "string") return null;
                      return (
                        <ReviewRow
                          key={f.key}
                          label={f.label}
                          value={v}
                          isTags={f.isTags}
                        />
                      );
                    })}
                    {customEntries.length > 0 && (
                      <div className="space-y-3.5 border-t border-zinc-100 dark:border-zinc-800 pt-3.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                          ✨ AI-detected
                        </p>
                        {customEntries.map(([k, v]) => (
                          <ReviewRow key={k} label={k} value={String(v)} />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Actions */}
            <div className="flex gap-2.5 border-t border-zinc-100 dark:border-zinc-800 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowSaveReview(false)}
                className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSaveReview(false);
                  handleSave();
                }}
                disabled={saving || !extracted.name?.trim()}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Confirm & save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera capture modal */}
      {cameraOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 15, 30, 0.7)", backdropFilter: "blur(6px)" }}
          onClick={() => setCameraOpen(false)}
        >
          <div
            className="modal-card w-full max-w-md overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 64px -12px rgba(99,102,241,0.22), 0 8px 24px -4px rgba(0,0,0,0.12)" }}
          >
            <div className="relative aspect-[4/3] w-full bg-black">
              {cameraError ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-300 dark:text-zinc-600">
                  {cameraError}
                </div>
              ) : (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={capturePhoto}
                disabled={!!cameraError}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
              >
                <span aria-hidden>📷</span> Capture
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Extracted fields card ───────────────────────────────────────────────────

const FIELD_DEFS: {
  key: keyof ContactInput;
  label: string;
  multiline?: boolean;
  isTags?: boolean;
  placeholder?: string;
}[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "tags", label: "Tags", isTags: true },
  { key: "howWeMet", label: "How we met", multiline: true },
  { key: "birthday", label: "Birthday", placeholder: "MM-DD or MM-DD-YYYY" },
];

// A single read-only label/value row in the "Review & confirm" save modal.
function ReviewRow({
  label,
  value,
  isTags = false,
}: {
  label: string;
  value: string;
  isTags?: boolean;
}) {
  const tags = isTags
    ? value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      {isTags ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-700 dark:text-zinc-200"
            >
              {t}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-100">
          {value}
        </p>
      )}
    </div>
  );
}

function ExtractedCard({
  extracted,
  enrichedKeys = [],
  sources = [],
  lowConfidence = false,
  onUpdate,
}: {
  extracted: ContactInput;
  enrichedKeys?: string[];
  sources?: { title: string; url: string }[];
  lowConfidence?: boolean;
  onUpdate: (updated: ContactInput) => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  function updateField(key: keyof ContactInput, value: string) {
    onUpdate({ ...extracted, [key]: value });
  }

  function updateCustomField(key: string, value: string) {
    onUpdate({
      ...extracted,
      customFields: { ...(extracted.customFields ?? {}), [key]: value },
    });
  }

  function removeCustomField(key: string) {
    const next = { ...(extracted.customFields ?? {}) };
    delete next[key];
    onUpdate({
      ...extracted,
      customFields: Object.keys(next).length > 0 ? next : undefined,
    });
  }

  const missingFields = FIELD_DEFS.filter((f) => !extracted[f.key]);

  // Telegram is a first-class contact method (like WhatsApp), but it can't be
  // derived from the phone — it needs an @username. Surface a dedicated row for
  // it, and keep it OUT of the AI-detected list below so it never shows twice.
  const telegramKey =
    findSocial(extracted.customFields, "telegram")?.key ?? "Telegram";
  const telegramValue = extracted.customFields?.[telegramKey] ?? "";
  const telegramSocial = telegramValue
    ? resolveSocial(telegramKey, telegramValue)
    : null;
  const missingCount = missingFields.length + (telegramValue ? 0 : 1);

  const setTelegram = (value: string) => {
    const next = { ...(extracted.customFields ?? {}) };
    if (value.trim()) next[telegramKey] = value;
    else delete next[telegramKey];
    onUpdate({
      ...extracted,
      customFields: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  const customEntries = Object.entries(extracted.customFields ?? {}).filter(
    ([k, v]) => {
      const s = resolveSocial(k, v);
      return !(s && s.platform === "telegram");
    }
  );
  const enrichedSet = new Set(enrichedKeys);
  const detectedEntries = customEntries.filter(([k]) => !enrichedSet.has(k));
  const enrichedEntries = customEntries.filter(([k]) => enrichedSet.has(k));

  const renderCustomRow = ([key, value]: [string, string]) => {
    const social = resolveSocial(key, value);
    return (
    <div key={key} className="flex items-start gap-1.5">
      <div className="flex-1">
        <FieldRow
          label={key}
          value={value}
          isEditing={editingField === `custom:${key}`}
          multiline={value.length > 60}
          onStartEdit={() => setEditingField(`custom:${key}`)}
          onCommit={(v) => {
            updateCustomField(key, v);
            setEditingField(null);
          }}
        />
        {social && editingField !== `custom:${key}` && (
          <a
            href={social.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <span aria-hidden>{social.icon}</span>
            <span className="truncate">{social.url.replace(/^https?:\/\//, "")}</span>
            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              ✓ Verified
            </span>
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={() => removeCustomField(key)}
        title="Remove this field"
        className="mt-5 shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-red-400 transition-colors text-xs leading-none px-1"
      >
        ✕
      </button>
    </div>
    );
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <FieldRow
        label="Name *"
        value={extracted.name ?? ""}
        isRequired
        isEditing={editingField === "name"}
        onStartEdit={() => setEditingField("name")}
        onCommit={(v) => {
          updateField("name", v);
          setEditingField(null);
        }}
      />

      {FIELD_DEFS.flatMap((f) => {
        const hasValue = Boolean(extracted[f.key]);
        // For the phone field, surface a one-tap "Message on WhatsApp" link
        // derived from the number (api.whatsapp.com/send) — same as the saved
        // contact page, so the chat is reachable straight from the preview. No
        // lookup/API: the number IS the WhatsApp account. Needs international
        // format (+63…, no leading 0).
        const waLinks =
          f.key === "phone" && hasValue && editingField !== "phone"
            ? phoneLinks(String(extracted.phone ?? ""))
            : null;
        return [
          hasValue || showMissing ? (
            <Fragment key={f.key}>
              <FieldRow
                label={f.label}
                value={(extracted[f.key] as string) ?? ""}
                isEditing={editingField === f.key}
                multiline={f.multiline}
                isTags={f.isTags}
                placeholder={f.placeholder}
                onStartEdit={() => setEditingField(f.key)}
                onCommit={(v) => {
                  updateField(f.key, v);
                  setEditingField(null);
                }}
              />
              {waLinks && (
                <a
                  href={waLinks.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open a WhatsApp chat with this number"
                  className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  <span aria-hidden>💬</span>
                  <span className="truncate">Message on WhatsApp</span>
                  <span
                    title="Built from the saved number — WhatsApp isn't checked live; clicking confirms it."
                    className="inline-flex shrink-0 items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    From your notes
                  </span>
                </a>
              )}
            </Fragment>
          ) : null,
          // Telegram sits directly after Phone (and before Location) — a
          // dedicated contact-method row that needs an @username, so it can't be
          // derived from the number. Rendered here regardless of whether the
          // Phone row itself is shown. Hidden when empty unless "Add missing
          // fields" is open.
          f.key === "phone" && (telegramValue || showMissing) ? (
            <div key="telegram">
              <FieldRow
                label="Telegram"
                value={telegramValue}
                isEditing={editingField === "telegram"}
                placeholder="@username"
                onStartEdit={() => setEditingField("telegram")}
                onCommit={(v) => {
                  setTelegram(v);
                  setEditingField(null);
                }}
              />
              {telegramSocial && editingField !== "telegram" && (
                <a
                  href={telegramSocial.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open a Telegram chat"
                  className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-xs text-sky-600 dark:text-sky-400 hover:underline"
                >
                  <span aria-hidden>{telegramSocial.icon}</span>
                  <span className="truncate">{telegramSocial.handle}</span>
                  <span
                    title="From your note — Telegram isn't checked live; clicking confirms it."
                    className="inline-flex shrink-0 items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    From your notes
                  </span>
                </a>
              )}
            </div>
          ) : null,
        ];
      })}

      {missingCount > 0 && (
        <button
          type="button"
          onClick={() => setShowMissing((s) => !s)}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {showMissing
            ? "− Hide empty fields"
            : `+ Add missing fields (${missingCount})`}
        </button>
      )}

      {detectedEntries.length > 0 && (
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400 dark:text-indigo-400">
            ✦ AI-detected
          </p>
          {detectedEntries.map(renderCustomRow)}
        </div>
      )}

      {enrichedEntries.length > 0 && (
        <div className="pt-3 border-t border-amber-100 dark:border-amber-900/40 space-y-3 -mx-4 -mb-4 mt-3 rounded-b-lg bg-amber-50/60 dark:bg-amber-950/30 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              🌐 Enriched from public knowledge
            </p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300">
              Pulled from the public web — may be outdated or wrong. Verify
              before saving; remove any you don&apos;t want.
            </p>
            {lowConfidence && (
              <p className="mt-1.5 rounded-md bg-amber-100/80 dark:bg-amber-900/40 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                ⚠️ Matched on the name alone — confirm this is the right person
                before saving. Add a detail (company, city, how you met) and
                re-run to narrow it down.
              </p>
            )}
          </div>
          {enrichedEntries.map(renderCustomRow)}

          {sources.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600/80 dark:text-amber-400">
                Sources
              </p>
              <ul className="mt-1 space-y-0.5">
                {sources.map((s) => (
                  <li key={s.url} className="truncate text-[11px]">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-700 dark:text-amber-300 underline hover:text-amber-900"
                    >
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Contacts with a birthday in the next 30 days, soonest first. Uses the shared
// birthday helper so the stored canonical format ("YYYY-MM-DD" / "--MM-DD") and
// custom-field fallbacks are handled consistently with the dashboard.
function UpcomingBirthdays({ contacts }: { contacts: Contact[] }) {
  const upcoming = computeUpcomingBirthdays(contacts, 30);
  if (upcoming.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 p-4">
      <h2 className="mb-3 text-sm font-semibold text-amber-900 dark:text-amber-200">
        🎂 Upcoming birthdays
      </h2>
      <ul className="space-y-2">
        {upcoming.map(({ contact, daysUntil }) => (
          <li key={contact.id} className="flex items-center justify-between gap-2">
            <Link
              href={`/contacts/${contact.id}`}
              className="text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-indigo-600 truncate"
            >
              {contact.name}
            </Link>
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">
              {daysUntil === 0
                ? "Today 🎉"
                : daysUntil === 1
                ? "Tomorrow"
                : `in ${daysUntil} days`}
              {" · "}
              {formatBirthday(contact.birthday)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FieldRow({
  label,
  value,
  isRequired,
  isEditing,
  multiline,
  isTags,
  placeholder,
  onStartEdit,
  onCommit,
}: {
  label: string;
  value: string;
  isRequired?: boolean;
  isEditing: boolean;
  multiline?: boolean;
  isTags?: boolean;
  placeholder?: string;
  onStartEdit: () => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const escapedRef = useRef(false);
  useEffect(() => setDraft(value), [value]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !multiline) onCommit(draft);
    if (e.key === "Escape") {
      escapedRef.current = true;
      onCommit(value);
    }
  }

  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      {isEditing ? (
        multiline ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (!escapedRef.current) onCommit(draft); escapedRef.current = false; }}
            onKeyDown={handleKeyDown}
            rows={2}
            className="input mt-1 w-full resize-y"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (!escapedRef.current) onCommit(draft); escapedRef.current = false; }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="input mt-1 w-full"
          />
        )
      ) : (
        <div
          role="button"
          onClick={onStartEdit}
          className="group mt-1 flex cursor-text items-center justify-between rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          {isTags && value ? (
            <div className="flex flex-wrap gap-1">
              {value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300"
                  >
                    {t}
                  </span>
                ))}
            </div>
          ) : value ? (
            <span className="text-sm text-zinc-700 dark:text-zinc-200">{value}</span>
          ) : (
            <span
              className={`text-sm italic ${
                isRequired ? "text-red-400 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              {isRequired ? "Not found — tap to add" : "—"}
            </span>
          )}
          <span className="ml-2 text-xs text-zinc-300 dark:text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
            ✎
          </span>
        </div>
      )}
    </div>
  );
}
