"use client"

import { useState } from "react"
import { FollowUpDraftModal } from "@/components/FollowUpDraftModal"
import type { Contact, HealthInputs } from "@/lib/types"

const CADENCE_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
}

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  annually: 365,
}

function getCadenceDays(cadence: string, customDays: number | null): number | null {
  if (cadence === "custom") return customDays
  return CADENCE_DAYS[cadence] ?? null
}

export function FollowUpCard({ contact }: { contact: Contact }) {
  const [showDraft, setShowDraft] = useState(false)

  if (!contact.followUpCadence) return null

  const cadDays = getCadenceDays(contact.followUpCadence, contact.followUpCadenceDays ?? null)
  const lastNoteAt = (contact.healthInputs as HealthInputs | null)?.lastNoteAt ?? null

  const daysSinceLast =
    lastNoteAt != null
      ? Math.floor((Date.now() - new Date(lastNoteAt).getTime()) / (24 * 60 * 60 * 1000))
      : null

  const dueIn = cadDays != null && daysSinceLast != null ? cadDays - daysSinceLast : null
  const isOverdue = dueIn != null && dueIn < 0
  const isDueToday = dueIn === 0

  const label =
    contact.followUpCadence === "custom"
      ? `Every ${contact.followUpCadenceDays} days`
      : CADENCE_LABEL[contact.followUpCadence] ?? contact.followUpCadence

  let statusText: string
  let statusClass: string
  if (lastNoteAt == null) {
    statusText = "No notes yet — time to reach out"
    statusClass = "text-amber-600 font-medium"
  } else if (isOverdue) {
    const days = Math.abs(dueIn!)
    statusText = `Overdue by ${days} day${days === 1 ? "" : "s"}`
    statusClass = "text-red-500 font-medium"
  } else if (isDueToday) {
    statusText = "Due today"
    statusClass = "text-amber-600 font-medium"
  } else {
    statusText = `Due in ${dueIn} day${dueIn === 1 ? "" : "s"}`
    statusClass = "text-zinc-500"
  }

  return (
    <>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Follow-up</h2>
          <button
            onClick={() => setShowDraft(true)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Draft message
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">Cadence</dt>
            <dd className="text-zinc-700 dark:text-zinc-200">{label}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Last note
            </dt>
            <dd className="text-zinc-700 dark:text-zinc-200">
              {lastNoteAt
                ? new Date(lastNoteAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">Status</dt>
            <dd className={statusClass}>{statusText}</dd>
          </div>
        </dl>
      </div>

      {showDraft && (
        <FollowUpDraftModal
          contactId={contact.id}
          contactName={contact.name}
          onClose={() => setShowDraft(false)}
        />
      )}
    </>
  )
}
