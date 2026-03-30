import { db } from './db'
import { SubscriptionStatus } from '@prisma/client'

/**
 * Handle subscription expiry - hide all seller's listings
 * Called when subscription.deleted event is received
 */
export async function handleSubscriptionExpiry(clerkUserId: string) {
  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: { sellerProfile: true },
  })

  if (!user) {
    console.error(`[Subscription] User not found: ${clerkUserId}`)
    return
  }

  // Update user subscription status
  await db.user.update({
    where: { clerkId: clerkUserId },
    data: {
      subscriptionStatus: SubscriptionStatus.EXPIRED,
      subscriptionExpiresAt: new Date(),
    },
  })

  // If user has a seller profile, hide all their listings
  if (user.sellerProfile) {
    const result = await db.eggListing.updateMany({
      where: {
        sellerId: user.sellerProfile.id,
        isAvailable: true, // Only hide currently visible listings
      },
      data: {
        isAvailable: false,
        hiddenBySubscription: true,
      },
    })

    console.log(
      `[Subscription] Hidden ${result.count} listings for user ${clerkUserId} due to subscription expiry`
    )
  }
}

/**
 * Handle subscription activation - restore listings hidden by subscription expiry
 * Called when subscription.created event is received
 */
export async function handleSubscriptionActivation(
  clerkUserId: string,
  subscriptionId: string,
  plan: string,
  expiresAt?: Date,
  listingLimit?: number
) {
  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: { sellerProfile: true },
  })

  if (!user) {
    console.error(`[Subscription] User not found: ${clerkUserId}`)
    return
  }

  // Update user subscription status
  await db.user.update({
    where: { clerkId: clerkUserId },
    data: {
      subscriptionId,
      subscriptionPlan: plan,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionExpiresAt: expiresAt,
      listingLimit,
    },
  })

  // If user has a seller profile, restore listings hidden by subscription expiry
  if (user.sellerProfile) {
    const result = await db.eggListing.updateMany({
      where: {
        sellerId: user.sellerProfile.id,
        hiddenBySubscription: true, // Only restore subscription-hidden listings
      },
      data: {
        isAvailable: true,
        hiddenBySubscription: false,
      },
    })

    console.log(
      `[Subscription] Restored ${result.count} listings for user ${clerkUserId} after subscription activation`
    )
  }
}

/**
 * Handle subscription update - update status and plan details
 * Called when subscription.updated event is received
 */
export async function handleSubscriptionUpdate(
  clerkUserId: string,
  subscriptionId: string,
  plan: string,
  status: 'active' | 'canceled',
  expiresAt?: Date,
  listingLimit?: number
) {
  const subscriptionStatus =
    status === 'active' ? SubscriptionStatus.ACTIVE : SubscriptionStatus.CANCELED

  await db.user.update({
    where: { clerkId: clerkUserId },
    data: {
      subscriptionId,
      subscriptionPlan: plan,
      subscriptionStatus,
      subscriptionExpiresAt: expiresAt,
      listingLimit,
    },
  })

  console.log(
    `[Subscription] Updated subscription for user ${clerkUserId}: ${plan} (${status})`
  )
}

/**
 * Check if user can create a new listing based on subscription and limits
 * Returns { allowed: true } or { allowed: false, reason: string, code: string }
 */
export async function canCreateListing(clerkUserId: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: string; code: 'SUBSCRIPTION_REQUIRED' | 'LISTING_LIMIT_REACHED' }
> {
  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: {
      sellerProfile: {
        include: {
          _count: {
            select: { listings: true },
          },
        },
      },
    },
  })

  if (!user) {
    return {
      allowed: false,
      reason: 'User not found',
      code: 'SUBSCRIPTION_REQUIRED',
    }
  }

  // Check subscription status (quick DB check before has() verification)
  if (user.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
    return {
      allowed: false,
      reason: 'Seller subscription required to create listings',
      code: 'SUBSCRIPTION_REQUIRED',
    }
  }

  // Check listing limit if set
  if (user.listingLimit !== null && user.sellerProfile) {
    const currentCount = user.sellerProfile._count.listings
    if (currentCount >= user.listingLimit) {
      return {
        allowed: false,
        reason: `Listing limit reached (${currentCount}/${user.listingLimit}). Upgrade your plan for more listings.`,
        code: 'LISTING_LIMIT_REACHED',
      }
    }
  }

  return { allowed: true }
}
