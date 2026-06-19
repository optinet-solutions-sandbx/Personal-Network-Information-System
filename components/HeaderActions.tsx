"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/types";
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
  const [open, setOpen] = useState<"messages" | "bell" | null>(null);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
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

    // Birthdays — today first, then upcoming within a week.
    for (const b of birthdays) {
      if (b.daysUntil === 0) {
        notes.push({
          key: `bday-${b.contact.id}`,
          contact: b.contact,
          title: `🎂 ${b.contact.name}'s birthday is today`,
          detail:
            b.turningAge != null
              ? `Turning ${b.turningAge} — send a message`
              : "Send a birthday message",
          href: `/contacts/${b.contact.id}`,
          accent: "bg-indigo-500",
        });
      } else if (b.daysUntil <= 7) {
        notes.push({
          key: `bday-${b.contact.id}`,
          contact: b.contact,
          title: `${b.contact.name}'s birthday ${
            b.daysUntil === 1 ? "is tomorrow" : `in ${b.daysUntil} days`
          }`,
          detail: b.next.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          }),
          href: `/contacts/${b.contact.id}`,
          accent: "bg-amber-500",
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

  // Badge counts time-sensitive items (today's birthdays, new connections, follow-ups due).
  const unreadCount = notifications.filter(
    (n) => n.accent !== "bg-amber-500"
  ).length;

  return (
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
                {suggestions.map((s, i) => (
                  <MessageRow
                    key={s.contact.id}
                    suggestion={s}
                    onMessage={() => { setOpen(null); setModalIndex(i); }}
                  />
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
              <EmptyState text="You're all caught up. Birthdays, follow-ups, and new connections will show up here." />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {notifications.map((n) => (
                  <li key={n.key}>
                    <Link
                      href={n.href}
                      onClick={() => setOpen(null)}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50"
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
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
      {modalIndex !== null && suggestions[modalIndex] && (
        <FollowUpDraftModal
          contactId={suggestions[modalIndex].contact.id}
          contactName={suggestions[modalIndex].contact.name}
          contactEmail={suggestions[modalIndex].contact.email}
          onClose={() => setModalIndex(null)}
          current={modalIndex + 1}
          total={suggestions.length}
          onPrev={modalIndex > 0 ? () => setModalIndex(modalIndex - 1) : undefined}
          onNext={modalIndex < suggestions.length - 1 ? () => setModalIndex(modalIndex + 1) : undefined}
        />
      )}
    </div>
  );
}

function MessageRow({
  suggestion: s,
  onMessage,
}: {
  suggestion: Suggestion;
  onMessage: () => void;
}) {
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
        <span className="block truncate text-sm font-medium text-zinc-800">
          {s.contact.name}
        </span>
        <span className="block truncate text-xs text-zinc-400">{s.reason}</span>
      </span>
      <button
        onClick={onMessage}
        className="flex-shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
      >
        Message
      </button>
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
      <div className="max-h-96 overflow-y-auto">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-sm text-zinc-400">{text}</p>;
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
