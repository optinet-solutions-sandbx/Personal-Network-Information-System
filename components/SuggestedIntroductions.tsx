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

export default function SuggestedIntroductions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

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

  async function handleAction(id: string, status: "accepted" | "dismissed") {
    const snapshot = suggestions
    setSuggestions((prev) => prev.filter((s) => s.id !== id))
    const res = await fetch(`/api/suggestions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) setSuggestions(snapshot)
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
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">🤝 Suggested Introductions</h2>
        <button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          {generating ? "Analyzing…" : "Refresh"}
        </button>
      </div>

      {genError && (
        <p className="mb-2 text-xs text-red-500">{genError}</p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No suggestions yet.{" "}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-indigo-600 hover:underline disabled:opacity-50"
          >
            Analyze your network →
          </button>
        </p>
      ) : (
        <ul className="space-y-3">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-zinc-100 bg-zinc-50 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <Avatar name={s.contactA.name} />
                <span className="text-sm font-medium text-zinc-700">
                  {s.contactA.name}
                </span>
                <span className="text-xs text-zinc-400">↔</span>
                <Avatar name={s.contactB.name} />
                <span className="text-sm font-medium text-zinc-700">
                  {s.contactB.name}
                </span>
                <span className="ml-auto flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                  {s.score.toFixed(1)}
                </span>
              </div>
              <p className="mb-2 text-xs text-zinc-500">{s.rationale}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction(s.id, "accepted")}
                  className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  ✓ Introduce
                </button>
                <button
                  onClick={() => handleAction(s.id, "dismissed")}
                  className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-200"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
