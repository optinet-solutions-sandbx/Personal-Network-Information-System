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
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
  const [draftTime, setDraftTime] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number; type: "sent" | "draft" } | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState("")
  const [editingDraft, setEditingDraft] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [sentMessages, setSentMessages] = useState<Array<{ text: string; time: string }>>(() => {
    try {
      const saved = localStorage.getItem(`followup-sent-${contactId}`)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  function loadDraft(id: string) {
    setLoading(true)
    setError(false)
    setDraft("")
    fetch(`/api/contacts/${id}/follow-up-draft`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.draft === "string") {
          setDraft(data.draft)
          setDraftTime(nowTime())
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setRegenerating(false) })
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`followup-sent-${contactId}`)
      setSentMessages(saved ? JSON.parse(saved) : [])
    } catch {
      setSentMessages([])
    }
    loadDraft(contactId)
  }, [contactId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [sentMessages, loading])

  useEffect(() => {
    function close() { setContextMenu(null) }
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [])

  function openMenu(e: React.MouseEvent, type: "sent" | "draft", index: number) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type, index })
  }

  function deleteSentMessage(index: number) {
    setSentMessages((prev) => {
      const updated = prev.filter((_, i) => i !== index)
      try { localStorage.setItem(`followup-sent-${contactId}`, JSON.stringify(updated)) } catch {}
      return updated
    })
    setContextMenu(null)
  }

  function startEdit(index: number) {
    setEditingIndex(index)
    setEditingText(sentMessages[index].text)
    setContextMenu(null)
  }

  function saveEdit(index: number) {
    if (!editingText.trim()) return
    setSentMessages((prev) => {
      const updated = prev.map((msg, i) => i === index ? { ...msg, text: editingText } : msg)
      try { localStorage.setItem(`followup-sent-${contactId}`, JSON.stringify(updated)) } catch {}
      return updated
    })
    setEditingIndex(null)
  }

  function rewriteDraft() {
    setRegenerating(true)
    setError(false)
    fetch(`/api/contacts/${contactId}/follow-up-draft`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.draft === "string") {
          setDraft(data.draft)
          setDraftTime(nowTime())
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
      .finally(() => setRegenerating(false))
  }

  function send() {
    if (!draft.trim()) return
    const method: "email" | "manual" = contactEmail ? "email" : "manual"
    setSentMessages((prev) => {
      const updated = [...prev, { text: draft, time: draftTime || nowTime() }]
      try { localStorage.setItem(`followup-sent-${contactId}`, JSON.stringify(updated)) } catch {}
      return updated
    })
    setSending(true)
    fetch("/api/sent-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, body: draft, method }),
    })
      .catch(() => {})
      .finally(() => {
        setSending(false)
      })
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex w-[340px] flex-col overflow-hidden rounded-t-2xl rounded-b-xl bg-[#1c1e21] shadow-2xl ring-1 ring-black/30"
      style={{ height: "520px" }}
    >
        {/* Context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[140px] overflow-hidden rounded-xl bg-[#3a3b3c] py-1 shadow-xl ring-1 ring-black/30"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === "sent" && (
              <>
                <button
                  onClick={() => startEdit(contextMenu.index)}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-600"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
                <button
                  onClick={() => deleteSentMessage(contextMenu.index)}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-zinc-600"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  Delete
                </button>
              </>
            )}
            {contextMenu.type === "draft" && (
              <>
                <button
                  onClick={() => { setEditingDraft(true); setContextMenu(null) }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-600"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
                <button
                  onClick={() => { rewriteDraft(); setContextMenu(null) }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-600"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  Rewrite
                </button>
              </>
            )}
          </div>
        )}

        {/* Status toast */}
        {(sending || regenerating) && (
          <div className="absolute bottom-20 left-1/2 z-10 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 shadow-lg">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span className="text-xs font-medium text-white whitespace-nowrap">
                {sending ? "Sending message…" : "Generating text or content…"}
              </span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="relative flex-shrink-0">
            <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${avatarColor(contactName)}`}>
              {initials(contactName)}
            </span>
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 ring-2 ring-[#1c1e21]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{contactName}</p>
            <p className="text-xs text-green-400">Active now</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#6366f1] transition-colors hover:bg-[#3a3b3c]"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar]:hidden" style={{ minHeight: "8rem", scrollbarWidth: "none" }}>
          {sentMessages.map((msg, i) => (
            <div key={i} className="flex justify-end">
              <div
                onContextMenu={(e) => openMenu(e, "sent", i)}
                className="max-w-[72%] cursor-context-menu rounded-2xl rounded-br-sm bg-[#6366f1] px-3.5 pb-1.5 pt-2.5 text-sm text-white"
              >
                {editingIndex === i ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      autoFocus
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full resize-none rounded-lg bg-white/20 px-2 py-1 text-sm text-white placeholder-white/60 focus:outline-none"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingIndex(null)} className="text-[11px] text-white/70 hover:text-white">Cancel</button>
                      <button onClick={() => saveEdit(i)} className="text-[11px] font-semibold text-white hover:text-white/80">Save</button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                )}
                <div className="mt-0.5 flex items-center justify-end gap-1">
                  <span className="text-[10px] text-white/60">Sent {msg.time}</span>
                  <svg width="16" height="10" viewBox="0 0 16 10" fill="none" className="text-white/70">
                    <path d="M1 5l3 3 5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M6 5l3 3 5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>
          ))}

          {loading ? (
            <div className="flex justify-end">
              <div className="max-w-[72%] rounded-2xl rounded-br-sm bg-[#6366f1]/30 px-3.5 py-3 text-sm text-white/70">
                <span className="animate-pulse">Generating text or content…</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex justify-end">
              <p className="text-sm text-red-400">Couldn&apos;t generate a draft. Please try again.</p>
            </div>
          ) : null}
          <div ref={chatEndRef} />
        </div>

        {/* Compose bar */}
        {!loading && !error && (
          <div className="relative">
            {showEmoji && (
              <div className="absolute bottom-full right-0 z-10 mb-1 w-64 rounded-2xl bg-[#3a3b3c] p-2 shadow-xl">
                <div className="grid grid-cols-8 gap-0.5">
                  {["😀","😂","😍","🥰","😘","😊","😎","🤔","😅","😭","🥺","😢","😡","🤣","😇","🙏","👍","👎","❤️","🔥","✨","🎉","🎂","🎁","💪","👏","🙌","🤝","💯","✅","⭐","🌟","💫","🌹","🍕","☕","🎵","📱","💻","🚀","✈️","🏠","🐶","🐱","😴","🤩","😬","🫡"].map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => { setDraft((d) => d + em); setShowEmoji(false) }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-[#4a4b4c]"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}
          <div className="flex items-end gap-2 border-t border-[#3a3b3c] px-2 py-2">
            <button
              onClick={rewriteDraft}
              className="mb-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#6366f1] text-white transition-colors hover:bg-[#4f46e5]"
              aria-label="More / Rewrite"
              title="Rewrite message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
            <div className="flex-1 rounded-2xl bg-[#3a3b3c] px-3 py-1.5">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
                placeholder="Aa"
                className="w-full resize-none bg-transparent text-sm text-white placeholder-zinc-400 focus:outline-none [&::-webkit-scrollbar]:hidden"
                style={{ maxHeight: "8rem", overflowY: "auto", scrollbarWidth: "none" }}
              />
            </div>
            <div className="flex flex-shrink-0 items-center gap-0.5 mb-1">
              <button
                onClick={() => setShowEmoji((s) => !s)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#3a3b3c] ${showEmoji ? "text-white" : "text-[#6366f1]"}`}
                aria-label="Emoji"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm3.5-9a1.5 1.5 0 1 0-1.5-1.5A1.5 1.5 0 0 0 15.5 11zm-7 0A1.5 1.5 0 1 0 7 9.5 1.5 1.5 0 0 0 8.5 11zm3.5 6.5a5 5 0 0 0 4.33-2.5H7.67A5 5 0 0 0 12 17.5z"/></svg>
              </button>
              <button
                onClick={send}
                disabled={!draft.trim() || sending}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#6366f1] transition-colors hover:bg-[#3a3b3c] disabled:opacity-40"
                aria-label={contactEmail ? "Send email" : "Send message"}
                title={contactEmail ? "Send via email (Ctrl+Enter)" : "Send (Ctrl+Enter)"}
              >
                {sending ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#6366f1]/30 border-t-[#6366f1]" />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2z"/></svg>
                )}
              </button>
            </div>
          </div>
          </div>
        )}
    </div>
  )
}
