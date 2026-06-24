"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/types";
import type { Conversation } from "@/app/api/conversations/route";
import { computeUpcomingBirthdays } from "@/lib/birthdays";
import { FollowUpDraftModal } from "@/components/FollowUpDraftModal";

const AVATAR_COLORS = [
  "bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-red-400",
  "bg-sky-500", "bg-violet-500", "bg-pink-500", "bg-teal-500",
];

function avatarColor(name: string): string {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

const MS_PER_DAY = 86_400_000;
// How far ahead of a birthday we start nudging to plan a gift.
const GIFT_LEAD_DAYS = 14;

// Per-day record of which toasts have been seen, so a full reload doesn't
// re-pop the same alert. Keyed `${notifKey}|${YYYY-MM-DD}` and pruned to today.
const TOAST_STORE_KEY = "networky:seenToasts";

function readSeenToasts(today: string): Set<string> {
  try {
    const arr = JSON.parse(
      localStorage.getItem(TOAST_STORE_KEY) || "[]"
    ) as string[];
    return new Set(arr.filter((k) => k.endsWith(`|${today}`)));
  } catch {
    return new Set();
  }
}

function markToastsSeen(notifKeys: string[]) {
  if (notifKeys.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const seen = readSeenToasts(today);
  notifKeys.forEach((k) => seen.add(`${k}|${today}`));
  try {
    localStorage.setItem(TOAST_STORE_KEY, JSON.stringify([...seen]));
  } catch {
    /* storage unavailable/quota — non-fatal */
  }
}

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  annually: 365,
};

type Notification = {
  key: string;
  contact: Contact;
  title: string;
  detail: string;
  href: string;
  accent: string; // dot color
};

type Suggestion = {
  contact: Contact;
  reason: string;
  // A ready-to-send message draft for this outreach.
  subject: string;
  body: string;
};

// Header actions: a "keep in touch" message launcher and a notification bell.
// Both read from a single /api/contacts fetch and derive everything client-side
// (birthdays from customFields, new connections from createdAt) — no backend
// changes required.
export default function HeaderActions() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [open, setOpen] = useState<"messages" | "bell" | null>(null);
  // The contact whose chat window is currently open (Messenger-style).
  const [chatContact, setChatContact] = useState<{ id: string; name: string; email: string | null } | null>(null);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const [readKeys, setReadKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("pnis_read_notifications");
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((data: Contact[]) => Array.isArray(data) && setContacts(data))
      .catch(() => {});
  }, []);

  const loadConversations = useCallback(() => {
    fetch("/api/conversations")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Conversation[]) => Array.isArray(data) && setConversations(data))
      .catch(() => {});
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Close any open panel on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const { notifications } = useMemo(() => {
    const birthdays = computeUpcomingBirthdays(contacts, 30);

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const notes: Notification[] = [];

    // Birthdays — today is a greeting prompt; the lead-up is a gift reminder.
    for (const b of birthdays) {
      if (b.daysUntil === 0) {
        notes.push({
          key: `bday-${b.contact.id}`,
          contact: b.contact,
          title: `🎂 ${b.contact.name}'s birthday is today`,
          detail:
            b.turningAge != null
              ? `Turning ${b.turningAge} — send your wishes`
              : "Send your birthday wishes",
          href: `/contacts/${b.contact.id}`,
          accent: "bg-indigo-500",
        });
      } else if (b.daysUntil <= GIFT_LEAD_DAYS) {
        const when =
          b.daysUntil === 1 ? "tomorrow" : `in ${b.daysUntil} days`;
        notes.push({
          key: `gift-${b.contact.id}`,
          contact: b.contact,
          title: `🎁 Plan a gift for ${b.contact.name}`,
          detail: `Birthday ${when} · ${b.next.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}`,
          href: `/contacts/${b.contact.id}`,
          accent: "bg-pink-500",
        });
      }
    }

    // New connections — contacts added in the last 7 days.
    const newConnections = contacts
      .filter((c) => {
        const created = new Date(c.createdAt).getTime();
        return now.getTime() - created <= 7 * MS_PER_DAY;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 5);

    for (const c of newConnections) {
      const days = Math.floor(
        (now.getTime() - new Date(c.createdAt).getTime()) / MS_PER_DAY
      );
      notes.push({
        key: `new-${c.id}`,
        contact: c,
        title: `New connection: ${c.name}`,
        detail:
          [c.title, c.company].filter(Boolean).join(" · ") ||
          (days === 0 ? "Added today" : `Added ${days}d ago`),
        href: `/contacts/${c.id}`,
        accent: "bg-emerald-500",
      });
    }

    // Cadence-based follow-ups — contacts with a follow-up schedule that is now due.
    for (const c of contacts) {
      if (!c.followUpCadence) continue;
      const cadDays =
        c.followUpCadence === "custom"
          ? (c.followUpCadenceDays ?? null)
          : (CADENCE_DAYS[c.followUpCadence] ?? null);
      if (!cadDays) continue;
      const lastNoteAt = c.healthInputs?.lastNoteAt;
      const daysSince = lastNoteAt
        ? Math.floor((now.getTime() - new Date(lastNoteAt).getTime()) / MS_PER_DAY)
        : 99999;
      if (daysSince >= cadDays) {
        const daysOverdue = Math.max(0, daysSince - cadDays);
        notes.push({
          key: `followup-${c.id}`,
          contact: c,
          title: `Follow up with ${c.name}`,
          detail:
            daysOverdue === 0
              ? "Due today"
              : `Overdue by ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`,
          href: `/contacts/${c.id}`,
          accent: "bg-orange-500",
        });
      }
    }

    // Health-based follow-ups — Dormant or Fading contacts (capped at 3, no duplicate with cadence).
    const cadenceIds = new Set(notes.filter((n) => n.key.startsWith("followup-")).map((n) => n.key));
    contacts
      .filter(
        (c) =>
          (c.healthTier === "Dormant" || c.healthTier === "Fading") &&
          !cadenceIds.has(`followup-${c.id}`)
      )
      .sort((a, b) => {
        if (a.healthTier !== b.healthTier) return a.healthTier === "Dormant" ? -1 : 1;
        return (a.healthScore ?? 0) - (b.healthScore ?? 0);
      })
      .slice(0, 3)
      .forEach((c) => {
        notes.push({
          key: `health-${c.id}`,
          contact: c,
          title:
            c.healthTier === "Dormant"
              ? `Reconnect with ${c.name}`
              : `Reach out to ${c.name}`,
          detail:
            c.healthTier === "Dormant" ? "No recent activity" : "Relationship is fading",
          href: `/contacts/${c.id}`,
          accent: "bg-orange-500",
        });
      });

    // "Keep in touch" message suggestions: birthdays make the best prompts.
    const suggestionList: Suggestion[] = birthdays
      .filter((b) => b.daysUntil <= 14)
      .map((b) => ({
        contact: b.contact,
        reason:
          b.daysUntil === 0
            ? "Birthday today 🎂"
            : b.daysUntil === 1
            ? "Birthday tomorrow 🎂"
            : `Birthday in ${b.daysUntil} days 🎂`,
        subject:
          b.daysUntil === 0
            ? `Happy birthday, ${firstName(b.contact.name)}!`
            : `Thinking of you, ${firstName(b.contact.name)}`,
        body:
          b.daysUntil === 0
            ? `Hi ${firstName(b.contact.name)},\n\nHappy birthday! Wishing you a wonderful day and a fantastic year ahead.\n\nWarm regards`
            : `Hi ${firstName(b.contact.name)},\n\nYour birthday is coming up — wishing you an early happy birthday! Hope all is going well.\n\nWarm regards`,
      }));

    return { notifications: notes, suggestions: suggestionList };
  }, [contacts]);

  // Every surfaced item is time-sensitive (today's birthdays, gift lead-ups,
  // new connections), so the badge counts them all.
  const unreadCount = notifications.filter((n) => !readKeys.has(n.key)).length;

  // Facebook-style toasts: pop today's actionable items in the corner. We only
  // *show* here (no persistence), so React StrictMode's double-invoke can't
  // suppress them; items are marked seen on dismiss instead.
  useEffect(() => {
    if (notifications.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const seen = readSeenToasts(today);
    const fresh = notifications.filter(
      (n) => !seen.has(`${n.key}|${today}`)
    );
    if (fresh.length > 0) setToasts(fresh.slice(0, 3));
  }, [notifications]);

  // Auto-dismiss whatever is showing after a few seconds, marking it seen so a
  // reload won't re-pop it.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => {
      markToastsSeen(toasts.map((x) => x.key));
      setToasts([]);
    }, 8000);
    return () => clearTimeout(t);
  }, [toasts]);

  function dismissToast(key: string) {
    markToastsSeen([key]);
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }

  return (
    <>
    <div ref={rootRef} className="flex items-center gap-1">
      {/* Messages */}
      <div className="relative">
        <IconButton
          label="Messages"
          active={open === "messages"}
          onClick={() => setOpen(open === "messages" ? null : "messages")}
        >
          <MessageIcon />
          {conversations.length > 0 && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white" />
          )}
        </IconButton>
        {open === "messages" && (
          <MessengerPanel
            conversations={conversations}
            contacts={contacts}
            onClose={() => setOpen(null)}
            onOpenChat={(c) => { setOpen(null); setChatContact(c); }}
          />
        )}
      </div>

      {/* Notifications */}
      <div className="relative">
        <IconButton
          label="Notifications"
          active={open === "bell"}
          onClick={() => setOpen(open === "bell" ? null : "bell")}
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </IconButton>
        {open === "bell" && (
          <Panel title="Notifications" onClose={() => setOpen(null)}>
            {notifications.length === 0 ? (
              <EmptyState text="You're all caught up. Birthdays, follow-ups, and new connections will show up here." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {notifications.map((n) => {
                  const isUnread = !readKeys.has(n.key);
                  return (
                  <li key={n.key}>
                    <Link
                      href={n.href}
                      onClick={() => {
                        setReadKeys((prev) => {
                          const next = new Set([...prev, n.key]);
                          try { localStorage.setItem("pnis_read_notifications", JSON.stringify([...next])); } catch {}
                          return next;
                        });
                        setOpen(null);
                      }}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 ${isUnread ? "bg-zinc-700/40" : ""}`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${n.accent}`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-zinc-800">
                          {n.title}
                        </span>
                        <span className="block truncate text-xs text-zinc-400">
                          {n.detail}
                        </span>
                      </span>
                    </Link>
                  </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
      </div>
      {chatContact && (
        <FollowUpDraftModal
          contactId={chatContact.id}
          contactName={chatContact.name}
          contactEmail={chatContact.email}
          onClose={() => { setChatContact(null); loadConversations(); }}
          onSent={loadConversations}
        />
      )}
    </div>

    {/* Facebook-style toast stack, bottom-left */}
    {toasts.length > 0 && (
      <div className="pointer-events-none fixed bottom-5 left-5 z-[60] flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2">
        {toasts.map((n) => (
          <div
            key={n.key}
            className="fb-toast-enter pointer-events-auto overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
          >
            <div className="flex items-start gap-3 p-3">
              <span
                className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(
                  n.contact.name ?? ""
                )}`}
              >
                {(n.contact.name?.[0] ?? "?").toUpperCase()}
              </span>
              <Link
                href={n.href}
                onClick={() => dismissToast(n.key)}
                className="min-w-0 flex-1"
              >
                <span className="block text-sm font-medium text-zinc-800">
                  {n.title}
                </span>
                <span className="block truncate text-xs text-zinc-500">
                  {n.detail}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => dismissToast(n.key)}
                aria-label="Dismiss"
                className="flex-shrink-0 text-zinc-400 transition-colors hover:text-zinc-600"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
    </>
  );
}

// One row in the Chats list — used for both existing conversations and contact
// search results. `subtitle` is the message preview or the contact's role.
function ChatRow({
  name,
  subtitle,
  meta,
  onClick,
}: {
  name: string;
  subtitle: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <li
      onClick={onClick}
      className="mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-700/50"
    >
      <span
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${avatarColor(
          name ?? ""
        )}`}
      >
        {(name?.[0] ?? "?").toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-100">
          {name}
        </span>
        <span className="block truncate text-xs text-zinc-400">{subtitle}</span>
      </span>
      {meta && <span className="flex-shrink-0 text-[11px] text-zinc-500">{meta}</span>}
    </li>
  );
}

// Messenger-style "Chats" panel: lists conversations you've had (newest first),
// each reopening that contact's chat window. Searching switches to contact
// look-up so you can start a brand-new conversation with anyone.
function MessengerPanel({
  conversations,
  contacts,
  onClose,
  onOpenChat,
}: {
  conversations: Conversation[];
  contacts: Contact[];
  onClose: () => void;
  onOpenChat: (c: { id: string; name: string; email: string | null }) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const searchResults = q
    ? contacts.filter((c) => c.name?.toLowerCase().includes(q)).slice(0, 20)
    : [];

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl bg-[#242526] shadow-2xl ring-1 ring-black/30">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xl font-bold text-zinc-100">Chats</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 transition-colors hover:bg-zinc-600"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-full bg-zinc-700 px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 text-zinc-400">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search a contact to message"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-400 outline-none"
          />
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-500">
        {q ? (
          searchResults.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">No contacts found.</div>
          ) : (
            <ul>
              {searchResults.map((c) => (
                <ChatRow
                  key={c.id}
                  name={c.name}
                  subtitle={[c.title, c.company].filter(Boolean).join(" · ") || "Start a conversation"}
                  onClick={() => onOpenChat({ id: c.id, name: c.name, email: c.email })}
                />
              ))}
            </ul>
          )
        ) : conversations.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            No conversations yet. Search a contact to start chatting.
          </div>
        ) : (
          <ul>
            {conversations.map((conv) => (
              <ChatRow
                key={conv.contactId}
                name={conv.contact.name}
                subtitle={`You: ${conv.lastBody}`}
                meta={relativeTime(conv.lastSentAt)}
                onClick={() => onOpenChat(conv.contact)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-zinc-700/60 px-4 py-2.5 text-center">
        <Link href="/contacts" className="text-sm font-medium text-[#1877F2] hover:underline">
          See all contacts
        </Link>
      </div>
    </div>
  );
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="true"
      aria-expanded={active}
      onClick={onClick}
      className={`relative flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 ${
        active ? "bg-zinc-100 text-zinc-700" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
        <span className="text-sm font-semibold text-zinc-800">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 transition-colors hover:text-zinc-600"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-zinc-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-500">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-sm text-zinc-400">{text}</p>;
}

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
}

// Compact "time ago" for the chat list (e.g. "1m", "3h", "2d").
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function MessageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
