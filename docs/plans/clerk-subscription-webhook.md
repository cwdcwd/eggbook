# Plan: Clerk Subscription Webhook Integration

## TL;DR
Add subscription tracking to the database and extend the Clerk webhook to handle subscription events. Sellers need the `seller_plan` subscription with `listing` feature entitlement to create listings. Build for future plan tiers while implementing a single plan now.

---

## Architecture Decisions

- **Dual check model**: Store subscription in DB for queries + verify with `has()` at runtime for sensitive actions
- **Subscription expiry**: Hide listings (set `isAvailable = false`) when subscription ends; restore when resubscribed
- **Plan tiers**: Single `seller_plan` now, schema designed for future tiers
- **Feature name**: `listing` (entitlement attached to `seller_plan`)

---

## Steps

### Phase 1: Database Schema Update

1. **Add subscription fields to User model** in [prisma/schema.prisma](../../prisma/schema.prisma)
   - `subscriptionId` (String?) - Clerk subscription ID
   - `subscriptionPlan` (String?) - Plan name (e.g., "seller_plan")
   - `subscriptionStatus` (SubscriptionStatus enum) - NONE, ACTIVE, PAST_DUE, CANCELED, EXPIRED
   - `subscriptionExpiresAt` (DateTime?) - When subscription ends
   - `listingLimit` (Int?) - Max listings allowed (null = unlimited), for future tier support

2. **Create SubscriptionStatus enum**
   ```
   enum SubscriptionStatus {
     NONE
     ACTIVE
     PAST_DUE
     CANCELED
     EXPIRED
   }
   ```

3. **Run Prisma migration** — `npx prisma migrate dev --name add-subscription-fields`

### Phase 2: Webhook Handler Extension

4. **Extend Clerk webhook** at [src/app/api/webhooks/clerk/route.ts](../../src/app/api/webhooks/clerk/route.ts)
   - Add handlers for:
     - `subscription.created` → Set subscriptionStatus=ACTIVE, store plan details
     - `subscription.updated` → Update status, handle plan tier changes
     - `subscription.deleted` → Set status=CANCELED/EXPIRED, trigger listing hide logic
   - Reference existing user event handlers for pattern

5. **Create helper function** `handleSubscriptionExpiry(userId: string)` in [src/lib/subscription.ts](../../src/lib/subscription.ts) (new file)
   - Find user's SellerProfile
   - Set all their listings `isAvailable = false`
   - Log the action for audit trail

6. **Create helper function** `handleSubscriptionActivation(userId: string)`
   - Restore listings: Set `isAvailable = true` for listings where `hiddenBySubscription = true`
   - Reset `hiddenBySubscription = false` on restored listings
   - Add `hiddenBySubscription` boolean to EggListing model

### Phase 3: Listing Creation Gate

7. **Update listing creation check** in [src/app/api/listings/route.ts](../../src/app/api/listings/route.ts)
   - Change feature check from `create-listings` to `listing` to match requirement
   - Add listing limit check: count existing listings vs `user.listingLimit`
   - Return appropriate error codes: `SUBSCRIPTION_REQUIRED`, `LISTING_LIMIT_REACHED`

8. **Add dual verification pattern** — Check DB first for quick rejection, then verify with `has()` for the actual gate

### Phase 4: Update Copilot Instructions

9. **Update** [.github/copilot-instructions.md](../../.github/copilot-instructions.md)
   - Document subscription model and webhook events
   - Update feature name from `create-listings` to `listing`

---

## Relevant Files

- `prisma/schema.prisma` — Add subscription fields to User, new enum
- `src/app/api/webhooks/clerk/route.ts` — Extend with subscription event handlers
- `src/lib/subscription.ts` — **New file** for subscription helpers
- `src/app/api/listings/route.ts` — Update feature check, add limit check
- `.github/copilot-instructions.md` — Document subscription patterns

---

## Verification

1. **Schema migration** — Run `npx prisma migrate dev` and verify no errors
2. **Webhook signature** — Test with Clerk webhook test tool in dashboard
3. **subscription.created** — Create test subscription, verify DB updated with ACTIVE status
4. **subscription.deleted** — Cancel subscription, verify listings hidden
5. **Resubscribe** — Reactivate subscription, verify listings restored
6. **Listing creation gate** — Try creating listing without subscription, expect 403 SUBSCRIPTION_REQUIRED
7. **Listing limit** — Set listingLimit=1, create 2 listings, expect 403 LISTING_LIMIT_REACHED on second

---

## Decisions Made

1. **Listing restoration tracking** — ✅ Yes, add `hiddenBySubscription` field to EggListing to distinguish subscription-hidden vs manually hidden listings. This ensures only subscription-hidden listings are restored on resubscription.

2. **Grace period** — ✅ No grace period. Hide listings immediately when subscription ends (on `subscription.deleted` event). Do not use PAST_DUE status for grace handling.
