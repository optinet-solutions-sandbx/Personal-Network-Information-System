"use client";
import { useEffect, useState } from "react";
import type { GiftSuggestion } from "@/lib/types";

interface Props {
  contactId: string;
  contactName: string;
  daysUntil: number;
  // Called after a suggestion is saved as a note, so the parent can refresh the
  // notes list without a browser reload.
  onNoteSaved?: () => void;
}

export default function GiftSuggestions({ contactId, contactName, daysUntil, onNoteSaved }: Props) {
  const [suggestions, setSuggestions] = useState<GiftSuggestion[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  async function fetchSuggestions() {
    setLoading(true);
    setError(false);
    setSuggestions([]);
    setModel(null);
    setSaved(new Set());
    try {
      const res = await fetch(`/api/contacts/${contactId}/gifts`, { method: "POST" });
      if (!res.ok) throw new Error("non-ok response");
      const data = (await res.json()) as { suggestions: GiftSuggestion[]; model?: string };
      setSuggestions(data.suggestions ?? []);
      setModel(data.model ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function handleSelect(index: number, suggestion: GiftSuggestion) {
    if (saved.has(index)) return;
    const content = `🎁 Gift idea: ${suggestion.title} — ${suggestion.rationale}`;
    const res = await fetch(`/api/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source: "gift" }),
    });
    if (!res.ok) return;
    setSaved((prev) => new Set(prev).add(index));
    onNoteSaved?.();
  }

  const countdownLabel =
    daysUntil === 0
      ? `🎂 ${contactName}'s birthday is today! 🎉`
      : `🎂 ${contactName}'s birthday is in ${daysUntil} day${daysUntil === 1 ? "" : "s"}!`;

  return (
    <div className="mt-6 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-5">
      <p className="mb-4 font-medium text-amber-800 dark:text-amber-200">{countdownLabel}</p>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-zinc-800 dark:text-zinc-100">
          🎁 Gift Suggestions
        </h2>
        <button
          onClick={fetchSuggestions}
          disabled={loading}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40"
        >
          ↻ Regenerate
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-amber-100 dark:bg-amber-900/20" />
          ))}
        </div>
      )}

      {error && !loading && (
        <p className="text-sm text-red-500 dark:text-red-400">
          Couldn&apos;t load suggestions.{" "}
          <button onClick={fetchSuggestions} className="underline">
            Try again
          </button>
        </p>
      )}

      {!loading && !error && suggestions.length > 0 && (
        <>
        <ul className="space-y-2">
          {suggestions.map((s, i) => {
            const isSaved = saved.has(i);
            return (
              <li key={i}>
                <button
                  onClick={() => handleSelect(i, s)}
                  disabled={isSaved}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    isSaved
                      ? "cursor-default border-green-200 dark:border-emerald-900/50 bg-green-50 dark:bg-emerald-950/30"
                      : "border-amber-200 dark:border-amber-900/50 bg-white dark:bg-zinc-900 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{s.title}</span>
                    {isSaved && (
                      <span className="shrink-0 text-xs text-green-600 dark:text-emerald-400">Saved as note ✓</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{s.rationale}</p>
                </button>
              </li>
            );
          })}
        </ul>
        {model && (
          <p className="mt-3 text-[11px] text-amber-700/70 dark:text-amber-300/60">
            {model === "rule-based"
              ? "Rule-based suggestions (no AI)"
              : `✨ AI-generated · ${model}`}
          </p>
        )}
        </>
      )}
    </div>
  );
}
