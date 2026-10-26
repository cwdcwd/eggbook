/**
 * Listing lifecycle, entitlement, and visibility policies (bead fleet-ops-yzq.1.3).
 *
 * Pure decision core shared by the seller listing routes, the buyer order
 * flow, the admin reconciliation paths, and the subscription webhook port.
 * There are no database or network calls here: routes inject Prisma ports,
 * tests use in-memory stores.
 *
 * Enforced invariants:
 *
 * - Subscription-hidden listings (hiddenBySubscription: true) are NEVER shown
 *   or sold publicly; only the subscription-activation webhook may clear the
 *   flag to restore visibility.
 * - A suspended seller's listings (hiddenBySuspension: true) are NEVER shown
 *   or sold publicly; only the admin unsuspend / role-restore action may
 *   clear the flag, and it must restore ONLY the rows that action hid —
 *   never a subscription-hidden row the webhook owns, and never a row the
 *   seller deliberately paused. Suspension and role changes away from SELLER
 *   hide with the same marker, so every restore path (unsuspend, role
 *   restore to SELLER) restores exactly the marker rows.
 * - A seller may not re-list (isAvailable: true) a listing they don't own,
 *   nor flip a subscription-hidden or suspension-hidden listing back to
 *   public visibility — editing the rest of a hidden listing stays allowed
 *   so sellers and suspended sellers can prepare it. The relist WRITE itself
 *   additionally carries a seller-activity condition (see
 *   sellerRelistWhereGuard): a write can never land while the seller's
 *   account is inactive, regardless of the row's flags.
 * - A seller cannot exceed their listing cap even when two create requests
 *   race: the count must be re-checked inside the same per-seller serialized
 *   transaction that inserts (see decideListingCapCreate and the listings
 *   POST route's advisory-locked transaction). Creating a listing is ALSO an
 *   entitlement-gated write: the seller's activity/role is re-read inside
 *   that same serialized transaction (decideSellerCreateEligibility), so a
 *   suspension cannot slide past an earlier read, and the create path never
 *   re-uplifts a role an admin changed away from SELLER.
 * - A subscription-activation event re-lists ONLY rows of an ACTIVE seller
 *   (see subscriptionActivationRestoreSpec): an activation arriving while
 *   the seller is suspended leaves every row untouched, so no re-subscribe
 *   can make a suspended seller's inventory public. The write's seller
 *   activity condition is a to-one relation filter, atomic with the write:
 *   if suspension commits first the restore's where misses, and if the
 *   restore lands first the suspension's hide spec re-marks the (then
 *   publicly visible) row — the two stay race-tight with no extra locks.
 * - A listing with ANY order history (active or fulfilled/cancelled) cannot
 *   be deleted: active orders keep money/fulfillment traceable, historical
 *   orders keep the order trail's referential integrity explicit instead of
 *   relying on the schema's RESTRICT FK as an accidental 500 (see
 *   decideListingDeletion).
 * - Partial listing updates preserve every omitted optional field: a PUT
 *   without stockCount must not zero stock, without photos must not wipe the
 *   gallery, without description must not clear it (see sellerUpdateData).
 * - Admin-cancelled / refunded orders return stock WITHOUT re-enabling a
 *   listing that a seller or admin had taken off the market; the visibility
 *   flags must survive stock reconciliation untouched.
 */

/** Order statuses that block listing deletion via the active-order rule. */
export const ACTIVE_ORDER_STATUSES = ["PENDING", "CONFIRMED", "PAID"] as const;

/** Prisma predicate fragment every PUBLIC listing query must include. */
export const PUBLIC_LISTING_CONDITION = {
  isAvailable: true,
  hiddenBySubscription: false,
  hiddenBySuspension: false,
} as const;

/**
 * Visibility flags + the suspension marker carried on every listing row.
 * Suspension-hidden rows always have isAvailable: false too, so the public
 * condition above composes for them automatically.
 */
export type ListingFlags = {
  isAvailable: boolean;
  hiddenBySubscription: boolean;
  hiddenBySuspension: boolean;
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
 * Subscription-hidden and suspension-hidden listings count as unavailable:
 * a buyer must never reach checkout for a listing the expiry webhook or an
 * admin suspension hid.
 */
export function decideOrderPlacement(
  listing: ListingFlags & { stockCount: number },
  quantity: number
): OrderPlacementDecision {
  if (
    listing.hiddenBySubscription ||
    listing.hiddenBySuspension ||
    !listing.isAvailable
  ) {
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
    hiddenBySuspension: false;
  };
  data: { stockCount: { decrement: number } };
} {
  return {
    where: {
      id: listingId,
      stockCount: { gte: quantity },
      isAvailable: true,
      hiddenBySubscription: false,
      hiddenBySuspension: false,
    },
    data: { stockCount: { decrement: quantity } },
  };
}

// ---------------------------------------------------------------------------
// Seller rule: hidden listings return to the market only via their owner
// ---------------------------------------------------------------------------

export type SellerRelistDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "LISTING_HIDDEN_BY_SUBSCRIPTION" | "LISTING_HIDDEN_BY_SUSPENSION";
      message: string;
    };

/**
 * Decide whether a seller-visible isAvailable write is permitted. Only a
 * transition back to PUBLIC visibility is restricted: while
 * hiddenBySubscription is set, the activation webhook owns that flag; while
 * hiddenBySuspension is set, the admin unsuspend / role-restore action owns
 * it. The seller (or a stale dashboard toggle) must not clear either.
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
  if (requestedAvailable === true && current.hiddenBySuspension) {
    return {
      allowed: false,
      code: "LISTING_HIDDEN_BY_SUSPENSION",
      message: "Your seller account is suspended, so this listing stays hidden. It can be re-listed once the account is restored.",
    };
  }
  return { allowed: true };
}

/**
 * Race guard for seller relists: the updateMany where-clause fragment that
 * must accompany any isAvailable:true write, so a listing hidden by a
 * concurrent webhook expiry or admin suspension cannot be re-listed between
 * the pre-check and the write (count 0 → route disambiguates by re-reading
 * the flags and surfaces the owning actor's error).
 *
 * The guard also carries the seller-activity condition (the to-one relation
 * filter on the listing's seller) so the write ITSELF can never land while
 * the seller's account is inactive — an unmarked row (seller-paused, or one
 * whose webhook flag something else cleared) of a suspended seller is not
 * re-listable either. The route maps a count-0 with a flagless row and an
 * inactive seller to a coded suspension refusal.
 */
export function sellerRelistWhereGuard(): {
  hiddenBySubscription: false;
  hiddenBySuspension: false;
  seller: { isActive: true };
} {
  return {
    hiddenBySubscription: false,
    hiddenBySuspension: false,
    seller: { isActive: true },
  };
}

// ---------------------------------------------------------------------------
// Seller entitlement rule: suspension / role changes hide, restore is exact
// ---------------------------------------------------------------------------

/**
 * Admin suspension and role-changes away from SELLER apply this spec to the
 * seller's listings: every row that is publicly visible right now gets the
 * suspension marker and leaves the market. Rows the subscription webhook
 * already hid and rows the seller deliberately paused are NOT touched, so
 * restore can distinguish exactly the rows the suspension hid.
 */
export function sellerSuspensionHideSpec(sellerId: string): {
  where: { sellerId: string; isAvailable: true; hiddenBySuspension: false };
  data: { isAvailable: false; hiddenBySuspension: true };
} {
  return {
    where: {
      sellerId,
      isAvailable: true,
      hiddenBySuspension: false,
    },
    data: { isAvailable: false, hiddenBySuspension: true },
  };
}

/**
 * The matching restore spec for unsuspend / role-restore to SELLER: it
 * re-lists exactly the rows carrying the suspension marker and nothing else.
 * hiddenBySubscription rows stay hidden (owned by the activation webhook);
 * seller-paused rows (no marker) stay paused.
 */
export function sellerSuspensionRestoreSpec(sellerId: string): {
  where: { sellerId: string; hiddenBySuspension: true };
  data: { isAvailable: true; hiddenBySuspension: false };
} {
  return {
    where: {
      sellerId,
      hiddenBySuspension: true,
    },
    data: { isAvailable: true, hiddenBySuspension: false },
  };
}

// ---------------------------------------------------------------------------
// Seller entitlement rule: creating a listing needs an active SELLER account
// ---------------------------------------------------------------------------

export type UserRoleValue = "BUYER" | "SELLER" | "ADMIN";

export type SellerCreateEligibilityDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "SELLER_SUSPENDED" | "NOT_A_SELLER";
      message: string;
    };

/**
 * Decide whether the caller may create a listing AT ALL — the entitlement
 * gate that stands beside Clerk's plan-feature check and the listing cap.
 * Two refusals, in order:
 *
 * 1. An INACTIVE seller profile (admin suspension, role change away from
 *    SELLER, or user deactivation) refuses with SELLER_SUSPENDED — with or
 *    without an active plan, a suspended seller cannot create listings, and
 *    a brand-new listing would otherwise be public the moment it inserts.
 * 2. A user whose role is not SELLER refuses with NOT_A_SELLER. This route
 *    must never re-uplift a role an admin explicitly changed away from
 *    SELLER (and never uplift ADMIN): the SELLER settings flow is the
 *    legitimate onboarding path.
 *
 * The create route evaluates this TWICE: a fast-fail against its pre-logged
 * read, and the authoritative evaluation inside the per-seller-advisory-lock
 * transaction against a FRESH user read — the admin suspend / unsuspend /
 * role-change / deactivate transactions hold the same lock, so a concurrent
 * suspension cannot slide between the eligibility read and the insert.
 */
export function decideSellerCreateEligibility(input: {
  role: UserRoleValue;
  hasSellerProfile: boolean;
  sellerProfileIsActive: boolean | null;
}): SellerCreateEligibilityDecision {
  if (input.hasSellerProfile && input.sellerProfileIsActive === false) {
    return {
      allowed: false,
      code: "SELLER_SUSPENDED",
      message: "Your seller account is suspended. An admin must restore it before you can create listings.",
    };
  }
  if (input.role !== "SELLER") {
    return {
      allowed: false,
      code: "NOT_A_SELLER",
      message: "Seller access required to create listings",
    };
  }
  return { allowed: true };
}

/**
 * Restore spec for the subscription-activation webhook: it re-lists rows
 * hidden by subscription expiry, but ONLY while the seller's account is
 * active — the seller-activity condition is part of the WHERE, evaluated
 * atomically with the write, so an activation event arriving while the
 * seller is suspended (expiry hides → suspension skips the already-hidden
 * row → re-subscribe) can never make a suspended seller's rows public
 * again. Rows carrying the suspension marker are not repaired here either
 * (the webhook owns only the subscription flag): a row hidden by BOTH
 * reasons while suspended keeps both flags, and its subscription flag
 * clears via a later activation once active or via admin enable after
 * unsuspend — the row stays non-public throughout either way.
 */
export function subscriptionActivationRestoreSpec(sellerId: string): {
  where: { sellerId: string; hiddenBySubscription: true; seller: { isActive: true } };
  data: { isAvailable: true; hiddenBySubscription: false };
} {
  return {
    where: {
      sellerId,
      hiddenBySubscription: true,
      seller: { isActive: true },
    },
    data: { isAvailable: true, hiddenBySubscription: false },
  };
}

// ---------------------------------------------------------------------------
// Listing cap rule: the limit must survive concurrent create races
// ---------------------------------------------------------------------------

export type ListingCapDecision =
  | { allowed: true }
  | { allowed: false; code: "LISTING_LIMIT_REACHED"; message: string };

/**
 * Decide whether a new listing may be created when the seller already holds
 * `currentCount` listings against `listingLimit` (null = unlimited). This is
 * a PURE decision: the route must evaluate it against a count read INSIDE the
 * same per-seller-serialized transaction that inserts the new row — a
 * count-then-create across separate awaits lets two concurrent creates both
 * pass and both insert, exceeding the cap.
 */
export function decideListingCapCreate(
  currentCount: number,
  listingLimit: number | null
): ListingCapDecision {
  if (listingLimit !== null && currentCount >= listingLimit) {
    return {
      allowed: false,
      code: "LISTING_LIMIT_REACHED",
      message: `Listing limit reached (${currentCount}/${listingLimit}). Upgrade your plan for more listings.`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Seller rule: a listing with any order history cannot be deleted
// ---------------------------------------------------------------------------

export type ListingDeletionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "LISTING_HAS_ACTIVE_ORDERS" | "LISTING_HAS_ORDER_HISTORY";
      message: string;
    };

/**
 * Retention policy, explicit instead of an accidental FK 500: listings with
 * ACTIVE orders (PENDING/CONFIRMED/PAID) cannot be deleted because money and
 * fulfillment must stay traceable; listings that only hold historical orders
 * (COMPLETED/CANCELLED/DECLINED) also cannot be deleted because the order
 * history's references must keep pointing at a real listing — disable it
 * instead. Routes evaluate this against counts read inside the locked
 * transaction and return the decision's code as the HTTP response code.
 */
export function decideListingDeletion(
  totalOrderCount: number,
  activeOrderCount: number
): ListingDeletionDecision {
  if (activeOrderCount > 0) {
    return {
      allowed: false,
      code: "LISTING_HAS_ACTIVE_ORDERS",
      message: "Cannot delete listing with active orders. Disable it instead.",
    };
  }
  if (totalOrderCount > 0) {
    return {
      allowed: false,
      code: "LISTING_HAS_ORDER_HISTORY",
      message: "Listing has order history and cannot be deleted. Disable it instead.",
    };
  }
  return { allowed: true };
}

/**
 * Deletion guard spec for the ownership-checked atomic delete. Deleting a
 * subscription-hidden or suspension-hidden listing is allowed (sellers may
 * clean up inventory an admin or the webhook hid); the flags live only for
 * public visibility.
 */
export function listingDeleteGuardSpec(
  listingId: string,
  sellerId: string
): { where: { id: string; sellerId: string } } {
  return { where: { id: listingId, sellerId } };
}

// ---------------------------------------------------------------------------
// Partial-update rule: omitted optional fields are preserved, not destroyed
// ---------------------------------------------------------------------------

/** Prisma PricingUnit enum values (mirror prisma/schema.prisma). */
export type PricingUnitValue = "EGG" | "HALF_DOZEN" | "DOZEN" | "FLAT" | "CUSTOM";

/**
 * The PUT body's scalar fields exactly as the Zod UpdateListingSchema parses
 * them (tags are a relation and stay in the route). Every field a partial
 * update may omit is optional here.
 */
export type SellerListingUpdatePayload = {
  title: string;
  description?: string | null;
  pricePerUnit: number;
  unit: PricingUnitValue;
  customUnitName?: string | null;
  customUnitQty?: number | null;
  stockCount?: number | null;
  photos?: string[];
  isAvailable?: boolean;
};

/**
 * The updateMany data payload: every key optional so omitted payload fields
 * leave the column untouched.
 */
export type SellerListingUpdateData = {
  title?: string;
  description?: string | null;
  pricePerUnit?: number;
  unit?: PricingUnitValue;
  customUnitName?: string | null;
  customUnitQty?: number | null;
  stockCount?: number;
  photos?: string[];
  isAvailable?: boolean;
};

/**
 * Build the omission-safe update data for a seller listing edit. Rules:
 *
 * - Omitted optional fields are ABSENT from the result, so the updateMany
 *   preserves the stored value (stock stays real stock, photos keep their
 *   gallery, description keeps its text).
 * - Explicit values overwrite; explicit null description clears it.
 * - isAvailable preserves the current row value when omitted (the relist
 *   where-guard in the route protects the actual transition).
 * - customUnitName/Qty follow the unit, not their own presence: unit=CUSTOM
 *   writes them (the schema refine guarantees both are present), any other
 *   unit clears stale custom pricing.
 *
 * Routes apply the returned object VERBATIM as the updateMany data; the
 * in-memory harness in the policy test suite applies the same object, so the
 * tested data shape cannot drift from the route's.
 */
export function sellerUpdateData(
  payload: SellerListingUpdatePayload,
  currentIsAvailable: boolean
): SellerListingUpdateData {
  return {
    title: payload.title.trim(),
    pricePerUnit: payload.pricePerUnit,
    ...(payload.description !== undefined && {
      description: payload.description ? payload.description.trim() : null,
    }),
    customUnitName:
      payload.unit === "CUSTOM" ? payload.customUnitName ?? null : null,
    customUnitQty:
      payload.unit === "CUSTOM" ? payload.customUnitQty ?? null : null,
    ...(payload.stockCount !== undefined && {
      stockCount: payload.stockCount ?? 0,
    }),
    ...(payload.photos !== undefined && { photos: payload.photos }),
    isAvailable:
      payload.isAvailable !== undefined ? payload.isAvailable : currentIsAvailable,
  };
}