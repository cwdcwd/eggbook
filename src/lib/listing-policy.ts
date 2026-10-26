/**
 * Listing lifecycle + visibility policies (bead fleet-ops-yzq.1.3).
 *
 * Pure decision core shared by the seller listing routes, the buyer order
 * flow, and the admin reconciliation paths. There are no database or network
 * calls here: routes inject Prisma ports, tests use in-memory stores.
 *
 * Enforced invariants:
 *
 * - Subscription-hidden listings (hiddenBySubscription: true) are NEVER shown
 *   or sold publicly; only the subscription-activation webhook may clear the
 *   flag to restore visibility.
 * - A seller may not re-list (isAvailable: true) a listing they don't own, nor
 *   flip a subscription-hidden listing back to public visibility — editing the
 *   rest of a hidden listing stays allowed so sellers can prepare it.
 * - A listing with active orders (PENDING / CONFIRMED / PAID) cannot be
 *   deleted — paid and in-flight orders must remain traceable.
 * - Admin-cancelled / refunded orders return stock WITHOUT re-enabling a
 *   listing that a seller or admin had taken off the market; the visibility
 *   flags must survive stock reconciliation untouched.
 */

/** Order statuses that block listing deletion and stock destruction. */
export const ACTIVE_ORDER_STATUSES = ["PENDING", "CONFIRMED", "PAID"] as const;

/** Prisma predicate fragment every PUBLIC listing query must include. */
export const PUBLIC_LISTING_CONDITION = {
  isAvailable: true,
  hiddenBySubscription: false,
} as const;

export type ListingFlags = {
  isAvailable: boolean;
  hiddenBySubscription: boolean;
};

// ---------------------------------------------------------------------------
// Buyer rule: only visible, stocked listings can be ordered
// ---------------------------------------------------------------------------

export type OrderPlacementDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "LISTING_UNAVAILABLE" | "INSUFFICIENT_STOCK";
      message: string;
    };

/**
 * Decide whether `quantity` units of the given listing can be ordered.
 * Subscription-hidden listings count as unavailable: a buyer must never
 * reach checkout for a listing the subscription-expiry webhook hid.
 */
export function decideOrderPlacement(
  listing: ListingFlags & { stockCount: number },
  quantity: number
): OrderPlacementDecision {
  if (listing.hiddenBySubscription || !listing.isAvailable) {
    return {
      allowed: false,
      code: "LISTING_UNAVAILABLE",
      message: "Listing is not currently available",
    };
  }
  if (listing.stockCount < quantity) {
    return {
      allowed: false,
      code: "INSUFFICIENT_STOCK",
      message: "Not enough stock",
    };
  }
  return { allowed: true };
}

/**
 * Conditional updateMany spec for the order-placement stock claim. The route
 * applies this verbatim so the visibility + stock guards are enforced ATOMICALLY
 * (the pre-check alone cannot survive a concurrent flag flip or stock draw).
 */
export function orderStockClaimSpec(
  listingId: string,
  quantity: number
): {
  where: {
    id: string;
    stockCount: { gte: number };
    isAvailable: true;
    hiddenBySubscription: false;
  };
  data: { stockCount: { decrement: number } };
} {
  return {
    where: {
      id: listingId,
      stockCount: { gte: quantity },
      isAvailable: true,
      hiddenBySubscription: false,
    },
    data: { stockCount: { decrement: quantity } },
  };
}

// ---------------------------------------------------------------------------
// Seller rule: hidden listings return to the market only via the webhook
// ---------------------------------------------------------------------------

export type SellerRelistDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "LISTING_HIDDEN_BY_SUBSCRIPTION";
      message: string;
    };

/**
 * Decide whether a seller-visible isAvailable write is permitted. Only a
 * transition back to PUBLIC visibility is restricted: while
 * hiddenBySubscription is set, the activation webhook owns that flag and the
 * seller (or a stale dashboard toggle) must not clear it.
 */
export function decideSellerRelist(
  current: ListingFlags,
  requestedAvailable: boolean | undefined
): SellerRelistDecision {
  if (requestedAvailable === true && current.hiddenBySubscription) {
    return {
      allowed: false,
      code: "LISTING_HIDDEN_BY_SUBSCRIPTION",
      message: "Listing is hidden by subscription expiry. Reactivate your subscription to relist it.",
    };
  }
  return { allowed: true };
}

/**
 * Race guard for seller relists: the updateMany where-clause fragment that
 * must accompany any isAvailable:true write, so a listing hidden by a
 * concurrent webhook expiry cannot be re-listed between the pre-check and
 * the write (count 0 → route surfaces LISTING_HIDDEN_BY_SUBSCRIPTION).
 */
export function sellerRelistWhereGuard(): { hiddenBySubscription: false } {
  return { hiddenBySubscription: false };
}

// ---------------------------------------------------------------------------
// Seller rule: listings with live orders cannot be deleted
// ---------------------------------------------------------------------------

export type ListingDeletionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "LISTING_HAS_ACTIVE_ORDERS";
      message: string;
    };

/** Deleting a listing that still has active (unfulfilled) orders would orphan
 * the payment trail; pause/disable it instead. */
export function decideListingDeletion(activeOrderCount: number): ListingDeletionDecision {
  if (activeOrderCount > 0) {
    return {
      allowed: false,
      code: "LISTING_HAS_ACTIVE_ORDERS",
      message: "Cannot delete listing with active orders. Disable it instead.",
    };
  }
  return { allowed: true };
}

/**
 * Deletion guard spec for the ownership-checked atomic delete. Deleting a
 * subscription-hidden listing is allowed (sellers may clean up inventory the
 * webhook hid); the flags live only for public visibility.
 */
export function listingDeleteGuardSpec(
  listingId: string,
  sellerId: string
): { where: { id: string; sellerId: string } } {
  return { where: { id: listingId, sellerId } };
}