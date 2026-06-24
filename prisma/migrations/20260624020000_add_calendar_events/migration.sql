-- Phase 3 (D7) calendar integrations: a cache of calendar events mirrored from
-- connected providers (Google Calendar, Outlook) to power meeting prep and
-- follow-ups. Additive: new table only, no changes to existing tables.

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "organizer" TEXT,
    "attendees" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "htmlLink" TEXT,
    "followUpDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_workspaceId_provider_externalId_key" ON "CalendarEvent"("workspaceId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "CalendarEvent_workspaceId_startsAt_idx" ON "CalendarEvent"("workspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_idx" ON "CalendarEvent"("userId");
