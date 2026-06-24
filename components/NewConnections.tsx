"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { SayHelloButton } from "./SayHelloButton"

const AVATAR_COLORS = [
  "bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-red-400",
  "bg-sky-500", "bg-violet-500", "bg-pink-500", "bg-teal-500",
]
function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length]
}
function initials(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}

type ApiContact = {
  id: string
  name: string
  title: string | null
  company: string | null
  email: string | null
  createdAt: string
}
type ApiLink = {
  id: string
  type: string
  createdAt: string
  contact: ApiContact
  via: { id: string; name: string } | null
}

// A normalized "person to greet" row, from either source.
type Entry = {
  key: string
  contact: ApiContact
  subtitle: string
}

function contactSubtitle(c: ApiContact): string {
  return [c.title, c.company].filter(Boolean).join(" · ")
}

export default function NewConnections() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    fetch("/api/new-connections")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { contacts?: ApiContact[]; links?: ApiLink[] } | null) => {
        if (!data) return
        const fromContacts: Entry[] = (data.contacts ?? []).map((c) => ({
          key: `c-${c.id}`,
          contact: c,
          subtitle: contactSubtitle(c) || "New connection",
        }))
        const fromLinks: Entry[] = (data.links ?? []).map((l) => ({
          key: `l-${l.id}`,
          contact: l.contact,
          subtitle: l.via ? `Connected via ${l.via.name}` : contactSubtitle(l.contact) || "New connection",
        }))
        setEntries([...fromContacts, ...fromLinks])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Hide the whole widget when there's nothing to greet, so the dashboard stays
  // clean. (Also hidden silently on the first load tick to avoid a flash.)
  if (loading || entries.length === 0) return null

  return (
    <div className="rounded-xl border border-indigo-400/30 bg-white bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent p-5 backdrop-blur-sm shadow-[0_0_24px_-8px_rgba(99,102,241,0.35)]">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-indigo-700">
          👋 New connections
        </h2>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {entries.length}
        </span>
      </div>
      <p className="mb-3 -mt-1 text-xs text-zinc-500">
        Recently added — say hello to break the ice.
      </p>
      <ul className="space-y-1">
        {entries.map((e) => (
          <li
            key={e.key}
            className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-zinc-50"
          >
            <Link href={`/contacts/${e.contact.id}`} className="flex-shrink-0">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(e.contact.name)}`}
              >
                {initials(e.contact.name)}
              </span>
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/contacts/${e.contact.id}`}
                className="block truncate text-sm font-medium text-zinc-800 hover:underline"
              >
                {e.contact.name}
              </Link>
              <span className="block truncate text-xs text-zinc-400">
                {e.subtitle}
              </span>
            </div>
            <SayHelloButton
              contactId={e.contact.id}
              contactName={e.contact.name}
              contactEmail={e.contact.email}
              onSent={load}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
