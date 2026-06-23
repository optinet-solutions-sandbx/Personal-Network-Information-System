"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { SentMessage } from "@/lib/types"

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
function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function SentMessages() {
  const [messages, setMessages] = useState<SentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    fetch("/api/sent-messages")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => Array.isArray(data) && setMessages(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function copyMessage(msg: SentMessage) {
    navigator.clipboard.writeText(msg.body).catch(() => {})
    setCopiedId(msg.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h2 className="mb-3 text-lg font-semibold">Sent Messages</h2>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">No messages sent yet.</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((msg) => {
            const name = msg.contact?.name ?? "Unknown"
            return (
              <li key={msg.id} className="flex items-start gap-3">
                <Link href={`/contacts/${msg.contactId}`} className="flex-shrink-0">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(name)}`}
                  >
                    {initials(name)}
                  </span>
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/contacts/${msg.contactId}`}
                      className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                    >
                      {name}
                    </Link>
                    <span className="text-[10px] text-zinc-400">{relativeTime(msg.sentAt)}</span>
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                      {msg.method === "email" ? "Email" : "Copied"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                    {msg.body}
                  </p>
                </div>
                <button
                  onClick={() => copyMessage(msg)}
                  className="flex-shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  title="Copy message"
                >
                  {copiedId === msg.id ? "Copied!" : "Copy"}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
