-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");
