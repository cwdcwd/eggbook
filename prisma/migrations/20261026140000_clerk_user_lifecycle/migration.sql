-- Retain the Clerk identity after anonymization so delayed or replayed
-- user events cannot recreate a deleted account.
CREATE TABLE "ClerkUserTombstone" (
    "clerkId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClerkUserTombstone_pkey" PRIMARY KEY ("clerkId")
);

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
