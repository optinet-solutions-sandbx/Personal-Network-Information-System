"use client"

import { useCallback, useEffect, useState } from "react"
import type { Suggestion } from "@/lib/types"

const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-red-400",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-teal-500",
]

function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length]
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(name)}`}
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  )
}

// Per-card UI state while an introduction is being made / confirmed.
type ActionState = "introducing" | "introduced" | "error"

export default function SuggestedIntroductions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [actionState, setActionState] = useState<Record<string, ActionState>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/suggestions")
      if (res.ok) setSuggestions(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleDismiss(id: string) {
    const snapshot = suggestions
    setSuggestions((prev) => prev.filter((s) => s.id !== id))
    const res = await fetch(`/api/suggestions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    })
    if (!res.ok) setSuggestions(snapshot)
  }

  // Introduce = mark the suggestion accepted AND create a real connection edge
  // between the two contacts, so they show as connected on each contact's page
  // and in the /network graph. We show an inline confirmation, then clear the
  // card so it doesn't resurface.
  async function handleIntroduce(s: Suggestion) {
    setActionState((prev) => ({ ...prev, [s.id]: "introducing" }))
    try {
      const [accept, connect] = await Promise.all([
        fetch(`/api/suggestions/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "accepted" }),
        }),
        fetch("/api/relationships", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromId: s.contactAId,
            toId: s.contactBId,
            type: "knows",
            note: "Introduced via Suggested Introductions",
          }),
        }),
      ])
      if (!accept.ok || !connect.ok) {
        setActionState((prev) => ({ ...prev, [s.id]: "error" }))
        return
      }
      setActionState((prev) => ({ ...prev, [s.id]: "introduced" }))
      // Leave the confirmation visible briefly, then remove the card.
      setTimeout(() => {
        setSuggestions((prev) => prev.filter((x) => x.id !== s.id))
      }, 2500)
    } catch {
      setActionState((prev) => ({ ...prev, [s.id]: "error" }))
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch("/api/suggestions", { method: "POST" })
      if (!res.ok) {
        setGenError("Analysis failed — please try again.")
        return
      }
      await load()
    } catch {
      setGenError("Analysis failed — please try again.")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">🤝 Suggested Introductions</h2>
        <button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          {generating ? "Analyzing…" : "Refresh"}
        </button>
      </div>

      {genError && (
        <p className="mb-2 text-xs text-red-500 dark:text-red-400">{genError}</p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          No suggestions yet.{" "}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
          >
            Analyze your network →
          </button>
        </p>
      ) : (
        <>
        <ul className="space-y-3">
          {(showAll ? suggestions : suggestions.slice(0, 5)).map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <Avatar name={s.contactA.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{s.contactA.name}</p>
                  {(s.contactA.title || s.contactA.company) && (
                    <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {[s.contactA.title, s.contactA.company].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <span className="flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500">↔</span>
                <Avatar name={s.contactB.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{s.contactB.name}</p>
                  {(s.contactB.title || s.contactB.company) && (
                    <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {[s.contactB.title, s.contactB.company].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <span className="ml-auto flex-shrink-0 rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  {s.score.toFixed(1)}
                </span>
              </div>
              <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{s.rationale}</p>
              {actionState[s.id] === "introduced" ? (
                <p className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  ✓ {s.contactA.name} and {s.contactB.name} are now connected.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleIntroduce(s)}
                    disabled={actionState[s.id] === "introducing"}
                    className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-60"
                  >
                    {actionState[s.id] === "introducing" ? "Connecting…" : "✓ Introduce"}
                  </button>
                  <button
                    onClick={() => handleDismiss(s.id)}
                    disabled={actionState[s.id] === "introducing"}
                    className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-60"
                  >
                    Dismiss
                  </button>
                  {actionState[s.id] === "error" && (
                    <span className="text-xs text-red-500 dark:text-red-400">
                      Couldn’t connect — try again.
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {suggestions.length > 5 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="mt-3 rounded-lg px-2 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {showAll ? "Show less" : `See ${suggestions.length - 5} more`}
          </button>
        )}
        </>
      )}
    </div>
  )
}
