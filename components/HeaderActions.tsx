"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/types";
import { computeUpcomingBirthdays } from "@/lib/birthdays";

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
  const [open, setOpen] = useState<"messages" | "bell" | null>(null);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then((data: Contact[]) => Array.isArray(data) && setContacts(data))
      .catch(() => {});
  }, []);

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

  const { notifications, suggestions } = useMemo(() => {
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
  const unreadCount = notifications.length;

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
          {suggestions.length > 0 && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white" />
          )}
        </IconButton>
        {open === "messages" && (
          <Panel title="Keep in touch" onClose={() => setOpen(null)}>
            {suggestions.length === 0 ? (
              <EmptyState text="No outreach suggestions right now. As birthdays approach, message drafts will appear here." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {suggestions.map((s) => (
                  <MessageRow key={s.contact.id} suggestion={s} />
                ))}
              </ul>
            )}
          </Panel>
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
              <EmptyState text="You're all caught up. Birthdays and new connections will show up here." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {notifications.map((n) => (
                  <li key={n.key}>
                    <Link
                      href={n.href}
                      onClick={() => setOpen(null)}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${n.accent}`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {n.title}
                        </span>
                        <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                          {n.detail}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>

    {/* Facebook-style toast stack, bottom-left */}
    {toasts.length > 0 && (
      <div className="pointer-events-none fixed bottom-5 left-5 z-[60] flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2">
        {toasts.map((n) => (
          <div
            key={n.key}
            className="fb-toast-enter pointer-events-auto overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg"
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
                <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {n.title}
                </span>
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {n.detail}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => dismissToast(n.key)}
                aria-label="Dismiss"
                className="flex-shrink-0 text-zinc-400 dark:text-zinc-500 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
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

function MessageRow({ suggestion: s }: { suggestion: Suggestion }) {
  const email = s.contact.email?.trim();
  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(
        s.subject
      )}&body=${encodeURIComponent(s.body)}`
    : null;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(
          s.contact.name ?? ""
        )}`}
      >
        {(s.contact.name?.[0] ?? "?").toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
          {s.contact.name}
        </span>
        <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">{s.reason}</span>
      </span>
      {mailto ? (
        <a
          href={mailto}
          className="flex-shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
        >
          Message
        </a>
      ) : (
        <Link
          href={`/contacts/${s.contact.id}`}
          className="flex-shrink-0 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Open
        </Link>
      )}
    </li>
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
      className={`relative flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200 ${
        active ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200" : ""
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
    <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg">
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-4 py-2.5">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 dark:text-zinc-500 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">{text}</p>;
}

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
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
