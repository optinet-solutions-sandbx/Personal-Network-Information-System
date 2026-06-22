"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import type { InsightItem, InsightType } from "@/lib/types"
import { FollowUpDraftModal } from "./FollowUpDraftModal"

const TYPE_ICON: Record<InsightType, string> = {
  birthday: "🎂",
  follow_up: "💬",
  introduction: "🤝",
  enrichment: "✨",
  cadence_due: "📅",
}

const TYPE_LABEL: Record<InsightType, string> = {
  birthday: "Birthday",
  follow_up: "Follow up",
  introduction: "Introduction",
  enrichment: "Profile updated",
  cadence_due: "Follow-up due",
}

const PRIORITY_BORDER: Record<number, string> = {
  1: "border-l-red-400",
  2: "border-l-amber-400",
  3: "border-l-zinc-300",
}

export default function InsightsFeed() {
  const [items, setItems] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [draftModal, setDraftModal] = useState<{ contactId: string; contactName: string } | null>(
    null
  )

  useEffect(() => {
    fetch("/api/insights")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setItems(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="mb-3 text-lg font-semibold">Today&apos;s Focus</h2>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Nothing needs your attention right now. Keep adding notes to maintain strong
          relationships.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={`${item.type}-${item.contactId}-${i}`}>
              {item.draftable ? (
                <div
                  className={`flex items-center gap-2 rounded-lg border-l-4 bg-zinc-50 px-3 py-2.5 ${PRIORITY_BORDER[item.priority] ?? "border-l-zinc-300"}`}
                >
                  <Link
                    href={item.actionUrl}
                    className="flex min-w-0 flex-1 items-start gap-3 transition-colors hover:opacity-75"
                  >
                    <span className="mt-0.5 flex-shrink-0 text-base leading-none">
                      {TYPE_ICON[item.type]}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-zinc-800">
                      {item.message}
                    </span>
                  </Link>
                  <button
                    onClick={() =>
                      setDraftModal({ contactId: item.contactId, contactName: item.contactName })
                    }
                    className="flex-shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
                  >
                    Draft
                  </button>
                </div>
              ) : (
                <Link
                  href={item.actionUrl}
                  className={`flex items-start gap-3 rounded-lg border-l-4 bg-zinc-50 px-3 py-2.5 transition-colors hover:bg-zinc-100 ${PRIORITY_BORDER[item.priority] ?? "border-l-zinc-300"}`}
                >
                  <span className="mt-0.5 flex-shrink-0 text-base leading-none">
                    {TYPE_ICON[item.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug text-zinc-800">
                      {item.message}
                    </span>
                    {item.secondaryContactId && (
                      <span className="mt-0.5 block text-xs text-zinc-400">
                        Also see: {item.secondaryContactName}
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-500">
                    {TYPE_LABEL[item.type]}
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {draftModal && (
        <FollowUpDraftModal
          contactId={draftModal.contactId}
          contactName={draftModal.contactName}
          onClose={() => setDraftModal(null)}
        />
      )}
    </div>
  )
}
