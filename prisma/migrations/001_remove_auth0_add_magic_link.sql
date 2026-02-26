-- Migration: Remove auth0Id from User, add MagicLinkToken table

-- Remove auth0Id column
ALTER TABLE "User" DROP COLUMN IF EXISTS "auth0Id";

-- Create MagicLinkToken table
CREATE TABLE "MagicLinkToken" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MagicLinkToken_tokenHash_key" ON "MagicLinkToken"("tokenHash");
CREATE INDEX "MagicLinkToken_userId_idx"            ON "MagicLinkToken"("userId");

ALTER TABLE "MagicLinkToken"
  ADD CONSTRAINT "MagicLinkToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
