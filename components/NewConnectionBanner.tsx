"use client"

import { useEffect, useState } from "react"
import { isNewConnection } from "@/lib/new-connections"
import { SayHelloButton } from "./SayHelloButton"

// A "new connection" nudge shown at the top of a contact's detail page when the
// contact was added recently and hasn't been greeted yet. Once you say hello
// (or if they already have any sent message), it hides itself.
export function NewConnectionBanner({
  contactId,
  contactName,
  contactEmail,
  createdAt,
}: {
  contactId: string
  contactName: string
  contactEmail?: string | null
  createdAt: string
}) {
  const recent = isNewConnection(createdAt)
  // null = unknown (still checking); avoids a flash before we know whether
  // they've already been greeted.
  const [greeted, setGreeted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!recent) return
    let cancelled = false
    fetch(`/api/contacts/${contactId}/sent-messages`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setGreeted(Array.isArray(data) && data.length > 0)
      })
      .catch(() => {
        if (!cancelled) setGreeted(false)
      })
    return () => { cancelled = true }
  }, [contactId, recent])

  if (!recent || greeted !== false) return null

  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-indigo-400/30 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent p-4 backdrop-blur-sm">
      <span className="text-xl" aria-hidden>🎉</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-indigo-700">
          New connection
        </p>
        <p className="truncate text-xs text-zinc-500">
          You recently added {contactName}. Break the ice with a quick hello.
        </p>
      </div>
      <SayHelloButton
        contactId={contactId}
        contactName={contactName}
        contactEmail={contactEmail}
        onSent={() => setGreeted(true)}
      />
    </div>
  )
}
