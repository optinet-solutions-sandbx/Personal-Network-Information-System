"use client"

import { useRef, useState } from "react"
import { FollowUpDraftModal } from "./FollowUpDraftModal"

// A "Say hello" action for a new connection. Opens the draft modal in greeting
// mode. `onSent` fires when the window is CLOSED after a message was sent —
// deferred to close (not the send itself) so the parent can refresh/drop the
// connection without unmounting the still-open window and hiding the message
// the user just sent.
//
// Safe to render inside a clickable row/link: the click is stopped from
// bubbling and the default prevented, so it won't trigger row navigation.
export function SayHelloButton({
  contactId,
  contactName,
  contactEmail,
  onSent,
  className,
  label = "Say hello",
}: {
  contactId: string
  contactName: string
  contactEmail?: string | null
  onSent?: () => void
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  // Whether a message was sent during this open session; gates the deferred
  // onSent fired on close.
  const sentRef = useRef(false)

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          sentRef.current = false
          setOpen(true)
        }}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
        }
      >
        <span aria-hidden>👋</span>
        {label}
      </button>
      {open && (
        <FollowUpDraftModal
          contactId={contactId}
          contactName={contactName}
          contactEmail={contactEmail}
          kind="hello"
          onClose={() => {
            setOpen(false)
            if (sentRef.current) {
              sentRef.current = false
              onSent?.()
            }
          }}
          onSent={() => { sentRef.current = true }}
        />
      )}
    </>
  )
}
