-- AlterTable
-- Listing-entitlement policy (bead fleet-ops-yzq.1.3): rows hidden because the
-- seller account was suspended (or the role changed away from SELLER) carry
-- this marker, so unsuspend / role-restore can re-list exactly the rows that
-- action hid without touching subscription-webhook rows or seller-paused rows.
ALTER TABLE "EggListing" ADD COLUMN "hiddenBySuspension" BOOLEAN NOT NULL DEFAULT false;