"use client"

import { useEffect, useRef, useState } from "react"

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

export function FollowUpDraftModal({
  contactId,
  contactName,
  contactEmail,
  onClose,
  onPrev,
  onNext,
  current,
  total,
}: {
  contactId: string
  contactName: string
  contactEmail?: string | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  current?: number
  total?: number
}) {
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sent, setSent] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(false)
    setDraft("")
    setSent(false)
    fetch(`/api/contacts/${contactId}/follow-up-draft`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.draft === "string") setDraft(data.draft)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [contactId])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function send() {
    if (!draft.trim()) return
    if (contactEmail) {
      window.open(
        `mailto:${contactEmail}?body=${encodeURIComponent(draft)}`,
        "_blank"
      )
    } else {
      navigator.clipboard.writeText(draft).catch(() => {})
    }
    setSent(true)
    setTimeout(() => setSent(false), 2500)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <span
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(contactName)}`}
          >
            {initials(contactName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{contactName}</p>
            {contactEmail ? (
              <p className="truncate text-xs text-zinc-400">{contactEmail}</p>
            ) : (
              <p className="text-xs text-zinc-400">No email — message will be copied</p>
            )}
          </div>
          {total != null && total > 1 && (
            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                onClick={onPrev}
                disabled={!onPrev}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-30"
                aria-label="Previous"
              >
                ‹
              </button>
              <span className="text-xs text-zinc-400">{current}/{total}</span>
              <button
                onClick={onNext}
                disabled={!onNext}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-30"
                aria-label="Next"
              >
                ›
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Message preview area */}
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ minHeight: "6rem" }}>
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <span className="text-sm text-zinc-400">Writing message…</span>
            </div>
          ) : error ? (
            <p className="text-sm text-red-500">Couldn&apos;t generate a draft. Please try again.</p>
          ) : (
            <div className="flex justify-end">
              <div className="max-w-xs rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2.5 text-sm text-white shadow-sm whitespace-pre-wrap">
                {draft || <span className="opacity-50">Type a message…</span>}
              </div>
            </div>
          )}
        </div>

        {/* Compose area */}
        {!loading && !error && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
            <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
                placeholder="Edit your message…"
                className="flex-1 resize-none bg-transparent text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none"
                style={{ maxHeight: "8rem", overflowY: "auto" }}
              />
              <button
                onClick={send}
                disabled={!draft.trim()}
                className="flex-shrink-0 rounded-full bg-indigo-600 p-2 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                aria-label={contactEmail ? "Send email" : "Copy message"}
                title={contactEmail ? "Send via email (Ctrl+Enter)" : "Copy to clipboard (Ctrl+Enter)"}
              >
                {sent ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2 11 13" />
                    <path d="M22 2 15 22 11 13 2 9l20-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-zinc-400">
              {contactEmail
                ? sent ? "Email client opened ✓" : "Opens your email app · Ctrl+Enter to send"
                : sent ? "Copied to clipboard ✓" : "No email — Ctrl+Enter copies to clipboard"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
