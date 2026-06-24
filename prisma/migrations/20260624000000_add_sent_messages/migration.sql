-- CreateTable
CREATE TABLE "SentMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SentMessage_contactId_idx" ON "SentMessage"("contactId");

-- CreateIndex
CREATE INDEX "SentMessage_userId_sentAt_idx" ON "SentMessage"("userId", "sentAt" DESC);

-- AddForeignKey
ALTER TABLE "SentMessage" ADD CONSTRAINT "SentMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

