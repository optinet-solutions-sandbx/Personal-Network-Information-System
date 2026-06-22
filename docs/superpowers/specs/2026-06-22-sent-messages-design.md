# Sent Messages Feature

**Date:** 2026-06-22

## Goal

When the user clicks Send in `FollowUpDraftModal`, persist the message and surface it in two places: a new "Sent" dashboard section and the contact detail page.

## Scope

- Add "Send" text label to the send button in the modal (next to the paper airplane icon)
- Persist sent message to DB on every send action
- New dashboard `SentMessages` component showing recent sends
- Sent messages list on contact detail page

## Data Model

New `SentMessage` Prisma model:

```prisma
model SentMessage {
  id        String   @id @default(cuid())
  userId    String?
  contactId String
  contact   Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  body      String   // full message text
  method    String   // "email" | "clipboard"
  sentAt    DateTime @default(now())

  @@index([contactId])
  @@index([userId, sentAt(sort: Desc)])
}
```

`Contact` gains a `sentMessages SentMessage[]` relation.

## API

- `POST /api/sent-messages` — body `{ contactId, body, method }` — creates record, returns it
- `GET /api/sent-messages` — returns recent sends (last 20, desc by sentAt) for dashboard
- `GET /api/contacts/[id]/sent-messages` — returns all sends for a contact (contact detail page)

## Modal Changes (`FollowUpDraftModal.tsx`)

1. Add "Send" text next to the paper airplane icon on the send button
2. After the existing clipboard/email action, POST to `/api/sent-messages` (fire-and-forget, no blocking)

## Dashboard (`SentMessages` component)

- New `components/SentMessages.tsx` — fetches `/api/sent-messages`
- Shows: contact avatar + name, message snippet (first 80 chars), method badge ("Email" / "Copied"), relative timestamp
- Copy button on each row re-copies the full body to clipboard
- Empty state: "No messages sent yet"
- Added to `app/dashboard/page.tsx` below `SuggestedIntroductions`

## Contact Detail Page

- New `SentMessagesList` sub-component in `app/contacts/[id]/`
- Fetches `/api/contacts/[id]/sent-messages`
- Shows chronological list of sent messages with full body (collapsed by default, expand on click) and method badge
- Placed in the contact detail layout after the notes section
