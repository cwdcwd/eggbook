/**
 * Persistence-level regression tests for listing lifecycle + visibility rules
 * (bead fleet-ops-yzq.1.3 "Enforce Eggbook seller, listing, and subscription
 * rules").
 *
 * Same harness contract as scripts/order-integrity-tests.ts: the route's
 * guarded Prisma updateMany is modeled in memory — an update applies ONLY when
 * every where-field still equals the live row's value, so the interleavings
 * the routes actually execute are exercised, not assumed.
 *
 * Run: node --import tsx --test scripts/listing-policy-tests.ts  (part of npm test)
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_ORDER_STATUSES,
  PUBLIC_LISTING_CONDITION,
  decideListingCapCreate,
  decideListingDeletion,
  decideOrderPlacement,
  decideSellerCreateEligibility,
  decideSellerRelist,
  orderStockClaimSpec,
  sellerRelistWhereGuard,
  sellerSuspensionHideSpec,
  sellerSuspensionRestoreSpec,
  sellerUpdateData,
  subscriptionActivationRestoreSpec,
  type ListingFlags,
} from "../src/lib/listing-policy";

// ---------------------------------------------------------------------------
// In-memory persistence with Prisma-like conditional-update semantics
// ---------------------------------------------------------------------------

interface ListingRow extends ListingFlags {
  id: string;
  sellerId: string;
  stockCount: number;
}

interface OrderRow {
  id: string;
  listingId: string;
  status: string;
}

interface SellerProfileRow {
  id: string;
  isActive: boolean;
}

function whereMatches(
  row: ListingRow,
  where: Record<string, unknown>,
  sellerProfiles?: Map<string, SellerProfileRow>
): boolean {
  for (const [field, expected] of Object.entries(where)) {
    // Prisma field-filter shape (e.g. { gte: n }) vs. literal value
    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      const filter = expected as Record<string, unknown>;
      // Prisma to-one relation filter (e.g. { seller: { isActive: true } }):
      // evaluated against the relation row's LIVE state at write time; a
      // relation row that doesn't exist matches nothing.
      if (field === "seller" && typeof filter.isActive === "boolean") {
        const profile = sellerProfiles?.get(row.sellerId);
        if (!profile || profile.isActive !== filter.isActive) return false;
        continue;
      }
      const value = row[field as keyof ListingRow];
      if (typeof value !== "number") return false;
      if ("gte" in filter && value < (filter.gte as number)) return false;
      continue;
    }
    if (row[field as keyof ListingRow] !== expected) return false;
  }
  return true;
}

class FakeListingStore {
  listings = new Map<string, ListingRow>();
  orders = new Map<string, OrderRow>();
  /** Seller profile (entitlement) state: the listing's seller relation. */
  sellerProfiles = new Map<string, SellerProfileRow>();

  /**
   * Seed a seller profile BEFORE its listings (seedListing only auto-seeds a
   * default ACTIVE profile when none exists yet, so this one sticks).
   */
  seedSellerProfile(id: string, isActive = true): SellerProfileRow {
    const profile = { id, isActive };
    this.sellerProfiles.set(id, profile);
    return profile;
  }

  seedListing(over: Partial<ListingRow> = {}): ListingRow {
    const row: ListingRow = {
      id: "l1",
      sellerId: "s1",
      stockCount: 5,
      isAvailable: true,
      hiddenBySubscription: false,
      hiddenBySuspension: false,
      ...over,
    };
    // Default to an ACTIVE profile so a test only has to seed a profile to
    // model an inactive (suspended / de-roled / deactivated) seller.
    if (!this.sellerProfiles.has(row.sellerId)) {
      this.seedSellerProfile(row.sellerId, true);
    }
    this.listings.set(row.id, row);
    return row;
  }

  seedOrder(over: Partial<OrderRow> = {}): OrderRow {
    const row: OrderRow = { id: `o${this.orders.size + 1}`, listingId: "l1", status: "PENDING", ...over };
    this.orders.set(row.id, row);
    return row;
  }

  orderCount(listingId: string): number {
    let count = 0;
    for (const order of this.orders.values()) {
      if (order.listingId === listingId) count += 1;
    }
    return count;
  }

  activeOrderCount(listingId: string): number {
    let count = 0;
    for (const order of this.orders.values()) {
      if (order.listingId === listingId && (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
        count += 1;
      }
    }
    return count;
  }

  listingsBySeller(sellerId: string): ListingRow[] {
    return [...this.listings.values()].filter((l) => l.sellerId === sellerId);
  }

  /**
   * Prisma updateMany semantics: ALL where-fields must still equal the live
   * row, and data supports the increment/decrement field operations. Applies
   * to every row matching `where` (updateMany, not update) and returns the
   * number of rows touched.
   */
  applySpec(spec: { where: Record<string, unknown>; data: Record<string, unknown> }): number {
    let count = 0;
    for (const row of this.listings.values()) {
      if (!whereMatches(row, spec.where, this.sellerProfiles)) continue;
      const writable = row as unknown as Record<string, unknown>;
      for (const [field, value] of Object.entries(spec.data)) {
        if (value !== null && typeof value === "object") {
          // Prisma numeric field operation: { increment: n } / { decrement: n }
          const op = value as Record<string, number>;
          const current = writable[field] as unknown;
          if (typeof current !== "number") continue;
          if ("increment" in op) writable[field] = current + op.increment;
          else if ("decrement" in op) writable[field] = current - op.decrement;
        } else {
          writable[field] = value;
        }
      }
      count += 1;
    }
    return count;
  }
}

// Route-shaped relist used by every relist test below (mirrors the PUT where/
// data exactly, so the guard fragments stay honest). `interleave` runs between
// the route's pre-check and its guard-write, like a concurrent webhook (or a
// suspension) firing. `sellerActive` mirrors what the seller row reads at the
// pre-check; the WRITE-side condition always comes from the store's live
// profile state, so an interleave that flips it is what the where-guard sees.
function sellerRelist(
  store: FakeListingStore,
  listingId: string,
  sellerId: string,
  interleave?: () => void,
  opts: { sellerActive?: boolean } = {}
) {
  const current = store.listings.get(listingId);
  assert.ok(current, "relist target must exist in test store");
  const sellerActive = opts.sellerActive ?? store.sellerProfiles.get(sellerId)?.isActive ?? true;

  // 1. Seller-activity gate (route pre-check).
  if (sellerActive === false) {
    return {
      allowed: false,
      code: "SELLER_SUSPENDED",
      message: "Your seller account is suspended, so listings cannot be re-listed. It can be re-listed once the account is restored.",
    };
  }

  // 2. Row-level lifecycle decision (pre-check).
  const precheck = decideSellerRelist(
    {
      isAvailable: current.isAvailable,
      hiddenBySubscription: current.hiddenBySubscription,
      hiddenBySuspension: current.hiddenBySuspension,
    },
    true
  );
  if (!precheck.allowed) return precheck;

  // 3. Interleave, then the guard-write.
  interleave?.();

  const spec = {
    where: { id: listingId, sellerId, ...sellerRelistWhereGuard() },
    data: { isAvailable: true, hiddenBySubscription: false },
  };
  const applied = store.applySpec(spec);
  if (applied === 0) {
    // Count-0 disambiguation (the route re-reads flags + seller activity):
    const after = store.listings.get(listingId);
    if (after?.hiddenBySubscription) throw new Error("HIDDEN_BY_SUBSCRIPTION");
    if (after?.hiddenBySuspension) throw new Error("HIDDEN_BY_SUSPENSION");
    const profile = store.sellerProfiles.get(sellerId);
    if (profile && !profile.isActive) throw new Error("SELLER_SUSPENDED");
    throw new Error("NOT_AUTHORIZED");
  }
  return precheck;
}

// ---------------------------------------------------------------------------
// decideOrderPlacement — buyer rules
// ---------------------------------------------------------------------------

test("order placement: subscription-hidden listings are unsellable", () => {
  const decision = decideOrderPlacement(
    { isAvailable: true, hiddenBySubscription: true, hiddenBySuspension: false, stockCount: 10 },
    1
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "LISTING_UNAVAILABLE");
});

test("order placement: suspension-hidden listings are unsellable", () => {
  const decision = decideOrderPlacement(
    { isAvailable: false, hiddenBySubscription: false, hiddenBySuspension: true, stockCount: 10 },
    1
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "LISTING_UNAVAILABLE");
});

test("order placement: seller-disabled listings are unsellable", () => {
  const decision = decideOrderPlacement(
    { isAvailable: false, hiddenBySubscription: false, hiddenBySuspension: false, stockCount: 10 },
    1
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "LISTING_UNAVAILABLE");
});

test("order placement: insufficient stock is distinct from unavailable", () => {
  const decision = decideOrderPlacement(
    { isAvailable: true, hiddenBySubscription: false, hiddenBySuspension: false, stockCount: 2 },
    3
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "INSUFFICIENT_STOCK");
  assert.equal(decision.allowed === false && decision.message, "Not enough stock");
});

test("order placement: public stocked listing is sellable", () => {
  assert.deepEqual(
    decideOrderPlacement(
      { isAvailable: true, hiddenBySubscription: false, hiddenBySuspension: false, stockCount: 5 },
      5
    ),
    { allowed: true }
  );
});

// ---------------------------------------------------------------------------
// orderStockClaimSpec — atomic claim carries the visibility guard
// ---------------------------------------------------------------------------

test("stock claim spec guards on visibility, subscription flag, suspension flag, and stock", () => {
  const spec = orderStockClaimSpec("l1", 2);
  assert.deepEqual(spec, {
    where: {
      id: "l1",
      stockCount: { gte: 2 },
      isAvailable: true,
      hiddenBySubscription: false,
      hiddenBySuspension: false,
    },
    data: { stockCount: { decrement: 2 } },
  });
});

test("stock claim refuses listings hidden AFTER the pre-check (webhook race)", () => {
  const store = new FakeListingStore();
  store.seedListing({ stockCount: 5 });
  const listing = store.listings.get("l1")!;
  // Route pre-check passes on the read snapshot...
  assert.deepEqual(
    decideOrderPlacement(
      {
        isAvailable: listing.isAvailable,
        hiddenBySubscription: listing.hiddenBySubscription,
        hiddenBySuspension: listing.hiddenBySuspension,
        stockCount: listing.stockCount,
      },
      2
    ),
    { allowed: true }
  );
  // ...then the expiry webhook fires before the transactional claim.
  listing.hiddenBySubscription = true;
  listing.isAvailable = false;
  // The claim must reject the write instead of selling a hidden listing.
  assert.equal(store.applySpec(orderStockClaimSpec("l1", 2)), 0);
  assert.equal(listing.stockCount, 5); // no stock destroyed, no order claim
});

test("stock claim refuses listings hidden by a concurrent suspension", () => {
  const store = new FakeListingStore();
  store.seedListing({ stockCount: 5 });
  const listing = store.listings.get("l1")!;
  listing.hiddenBySuspension = true;
  listing.isAvailable = false;
  assert.equal(store.applySpec(orderStockClaimSpec("l1", 2)), 0);
  assert.equal(listing.stockCount, 5);
});

test("stock claim honors concurrent stock draws", () => {
  const store = new FakeListingStore();
  store.seedListing({ stockCount: 2 });
  assert.equal(store.applySpec(orderStockClaimSpec("l1", 2)), 1);
  assert.equal(store.listings.get("l1")!.stockCount, 0);
  assert.equal(store.applySpec(orderStockClaimSpec("l1", 2)), 0);
});

// ---------------------------------------------------------------------------
// decideSellerRelist — seller rules
// ---------------------------------------------------------------------------

test("seller relist: subscription-hidden listings cannot be re-listed", () => {
  const decision = decideSellerRelist(
    { isAvailable: false, hiddenBySubscription: true, hiddenBySuspension: false },
    true
  );
  assert.equal(decision.allowed, false);
  assert.equal(
    decision.allowed === false && decision.code,
    "LISTING_HIDDEN_BY_SUBSCRIPTION"
  );
});

test("seller relist: suspension-hidden listings cannot be re-listed", () => {
  const decision = decideSellerRelist(
    { isAvailable: false, hiddenBySubscription: false, hiddenBySuspension: true },
    true
  );
  assert.equal(decision.allowed, false);
  assert.equal(
    decision.allowed === false && decision.code,
    "LISTING_HIDDEN_BY_SUSPENSION"
  );
});

test("seller relist: edits without a visibility flip stay allowed while hidden", () => {
  assert.deepEqual(
    decideSellerRelist(
      { isAvailable: false, hiddenBySubscription: true, hiddenBySuspension: false },
      undefined
    ),
    { allowed: true }
  );
  assert.deepEqual(
    decideSellerRelist(
      { isAvailable: false, hiddenBySubscription: true, hiddenBySuspension: false },
      false
    ),
    { allowed: true }
  );
  assert.deepEqual(
    decideSellerRelist(
      { isAvailable: false, hiddenBySubscription: false, hiddenBySuspension: true },
      undefined
    ),
    { allowed: true }
  );
});

test("seller relist: normal pause/restore of a non-hidden listing is allowed", () => {
  assert.deepEqual(
    decideSellerRelist(
      { isAvailable: false, hiddenBySubscription: false, hiddenBySuspension: false },
      true
    ),
    { allowed: true }
  );
  assert.deepEqual(
    decideSellerRelist(
      { isAvailable: true, hiddenBySubscription: false, hiddenBySuspension: false },
      true
    ),
    { allowed: true }
  );
});

test("seller relist: hidden listing re-lists ONLY after webhook activation", () => {
  const store = new FakeListingStore();
  store.seedListing({ isAvailable: false, hiddenBySubscription: true });

  // Activation webhook semantics (mirrors handleSubscriptionActivation's
  // restore): hiddenBySubscription-only rows become visible.
  store.applySpec({
    where: { id: "l1", sellerId: "s1", hiddenBySubscription: true },
    data: { isAvailable: true, hiddenBySubscription: false },
  });
  const restored = store.listings.get("l1")!;
  assert.equal(restored.isAvailable, true);
  assert.equal(restored.hiddenBySubscription, false);

  // Seller relist of a NOT-hidden listing is a plain flag write.
  restored.isAvailable = false;
  const outcome = sellerRelist(store, "l1", "s1");
  assert.equal(outcome.allowed, true);
  assert.equal(store.listings.get("l1")!.isAvailable, true);
});

test("seller relist: webhook re-hid wins the race against a stale dashboard toggle", () => {
  const store = new FakeListingStore();
  store.seedListing({ isAvailable: false, hiddenBySubscription: false });
  // Pre-check passes on the stale snapshot (not hidden)...
  const precheck = decideSellerRelist(
    {
      isAvailable: store.listings.get("l1")!.isAvailable,
      hiddenBySubscription: false,
      hiddenBySuspension: false,
    },
    true
  );
  assert.equal(precheck.allowed, true);
  // ...webhook hides concurrently, between the pre-check and the write...
  const row = store.listings.get("l1")!;
  // ...and the guarded relist must NO-OP and surface the hidden-relist error,
  // never re-list a subscription-hidden listing.
  assert.throws(
    () =>
      sellerRelist(store, "l1", "s1", () => {
        row.hiddenBySubscription = true;
        row.isAvailable = false;
      }),
    /HIDDEN_BY_SUBSCRIPTION/
  );
  assert.equal(row.isAvailable, false);
  assert.equal(row.hiddenBySubscription, true);
});

test("seller relist: admin suspension wins the race against a stale dashboard toggle", () => {
  const store = new FakeListingStore();
  store.seedListing({ isAvailable: false, hiddenBySubscription: false, hiddenBySuspension: false });
  const row = store.listings.get("l1")!;
  assert.throws(
    () =>
      sellerRelist(store, "l1", "s1", () => {
        row.hiddenBySuspension = true;
        row.isAvailable = false;
      }),
    /HIDDEN_BY_SUSPENSION/
  );
  assert.equal(row.isAvailable, false);
  assert.equal(row.hiddenBySuspension, true);
});

test("seller relist: cross-seller relist claims nothing (ownership guard)", () => {
  const store = new FakeListingStore();
  store.seedListing({ isAvailable: false, hiddenBySubscription: false });
  assert.throws(() => sellerRelist(store, "l1", "s2"), /NOT_AUTHORIZED/);
  assert.equal(store.listings.get("l1")!.isAvailable, false);
});

// ---------------------------------------------------------------------------
// Seller relist: seller-activity gate on the write (round-2 blocking item 2)
// ---------------------------------------------------------------------------

test("relist where-guard carries the seller-activity condition (race-tight)", () => {
  assert.deepEqual(sellerRelistWhereGuard(), {
    hiddenBySubscription: false,
    hiddenBySuspension: false,
    seller: { isActive: true },
  });
});

test("seller relist: an inactive seller cannot re-list an unmarked row (pre-check)", () => {
  // The relist gap: an unmarked (seller-paused) row of a suspended seller
  // carries no flags, so the row-level lifecycle decision would allow the
  // flip — the seller-activity pre-check and the write-side condition close
  // it.
  const store = new FakeListingStore();
  store.seedSellerProfile("s1", false); // suspended BEFORE the row
  store.seedListing({ id: "l1", isAvailable: false }); // paused, unmarked
  const result = sellerRelist(store, "l1", "s1", undefined, { sellerActive: false });
  assert.equal(result.allowed, false);
  assert.equal(result.allowed === false && result.code, "SELLER_SUSPENDED");
  assert.equal(store.listings.get("l1")!.isAvailable, false, "row stays paused");
});

test("seller relist: a suspension between the pre-check and the write is refused with the suspension code", () => {
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", isAvailable: false }); // paused, unmarked, active seller
  assert.throws(
    () =>
      sellerRelist(store, "l1", "s1", () => {
        // Admin suspension lands between pre-check and write. The row is
        // NOT publicly visible, so the hide spec (which only marks public
        // rows) doesn't touch it — but the seller is now inactive, and the
        // write's seller-activity condition must consume the update.
        store.seedSellerProfile("s1", false);
      }),
    /SELLER_SUSPENDED/
  );
  assert.equal(store.listings.get("l1")!.isAvailable, false, "not re-listed while suspended");
});

test("seller relist: an active seller's paused row still re-lists (positive control)", () => {
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", isAvailable: false });
  const result = sellerRelist(store, "l1", "s1");
  assert.equal(result.allowed, true);
  assert.equal(store.listings.get("l1")!.isAvailable, true);
});

// ---------------------------------------------------------------------------
// Seller suspension / role-change entitlement: hide-exact, restore-exact
// ---------------------------------------------------------------------------

test("suspension hide-spec takes only public rows and leaves hidden rows alone", () => {
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", sellerId: "s1", isAvailable: true });
  store.seedListing({ id: "l2", sellerId: "s1", isAvailable: false, hiddenBySubscription: true }); // webhook-hidden
  store.seedListing({ id: "l3", sellerId: "s1", isAvailable: false }); // seller-paused
  store.seedListing({ id: "l4", sellerId: "s2", isAvailable: true }); // other seller

  const touched = store.applySpec(sellerSuspensionHideSpec("s1"));
  assert.equal(touched, 1);

  const l1 = store.listings.get("l1")!;
  assert.equal(l1.isAvailable, false);
  assert.equal(l1.hiddenBySuspension, true);

  const l2 = store.listings.get("l2")!;
  assert.equal(l2.hiddenBySubscription, true, "webhook-hidden row untouched");
  assert.equal(l2.hiddenBySuspension, false);

  const l3 = store.listings.get("l3")!;
  assert.equal(l3.hiddenBySuspension, false, "seller-paused row has no marker");

  const l4 = store.listings.get("l4")!;
  assert.equal(l4.isAvailable, true, "other seller's listing untouched");
});

test("suspension restore-spec restores exactly the marked rows", () => {
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", sellerId: "s1" });
  store.applySpec(sellerSuspensionHideSpec("s1")); // hide l1
  store.seedListing({ id: "l2", sellerId: "s1", isAvailable: false, hiddenBySubscription: true }); // webhook-hidden
  store.seedListing({ id: "l3", sellerId: "s1", isAvailable: false }); // seller-paused, never hidden

  const touched = store.applySpec(sellerSuspensionRestoreSpec("s1"));
  assert.equal(touched, 1);

  const l1 = store.listings.get("l1")!;
  assert.equal(l1.isAvailable, true);
  assert.equal(l1.hiddenBySuspension, false);

  const l2 = store.listings.get("l2")!;
  assert.equal(l2.isAvailable, false, "subscription-hidden row stays hidden");
  assert.equal(l2.hiddenBySubscription, true);

  const l3 = store.listings.get("l3")!;
  assert.equal(l3.isAvailable, false, "seller-paused row stays paused");
});

// ---------------------------------------------------------------------------
// subscriptionActivationRestoreSpec — activation gates on seller activity
// (round-2 blocking item 3)
// ---------------------------------------------------------------------------

test("activation: a re-subscribe while suspended leaves subscription-hidden rows hidden, and the following unsuspend cannot repair them", () => {
  // The review's sequence: expiry hides → suspension skips the already-hidden
  // row (no marker) → seller re-subscribes while suspended → activation must
  // NOT re-list the row; with no marker, no unsuspend can repair it either.
  const store = new FakeListingStore();
  store.seedSellerProfile("s1", false); // suspended seller (before listing seed)
  store.seedListing({ id: "l1", isAvailable: false, hiddenBySubscription: true });
  assert.equal(store.applySpec(sellerSuspensionHideSpec("s1")), 0, "suspension must not mark an already-hidden row");

  // Activation while suspended: the seller-activity condition in the where
  // consumes the write — nothing is touched, the webhook flag stays set.
  assert.equal(store.applySpec(subscriptionActivationRestoreSpec("s1")), 0, "activation must refuse to restore for an inactive seller");
  const l1 = store.listings.get("l1")!;
  assert.equal(l1.isAvailable, false, "row must not go public while the seller is suspended");
  assert.equal(l1.hiddenBySubscription, true, "webhook flag stays set while suspended");
  assert.equal(l1.hiddenBySuspension, false, "no marker: suspension skipped this row");

  // The unsuspend that follows has no marker to repair — the row stays
  // non-public until a later activation while active, or admin enable.
  assert.equal(store.applySpec(sellerSuspensionRestoreSpec("s1")), 0, "unsuspend cannot restore a subscription-hidden row");
  assert.equal(store.listings.get("l1")!.isAvailable, false, "still non-public after unsuspend");
});

test("activation: restores a subscription-hidden row only for an active seller (positive control)", () => {
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", isAvailable: false, hiddenBySubscription: true });

  const touched = store.applySpec(subscriptionActivationRestoreSpec("s1"));
  assert.equal(touched, 1);

  const l1 = store.listings.get("l1")!;
  assert.equal(l1.isAvailable, true);
  assert.equal(l1.hiddenBySubscription, false);
  assert.equal(l1.hiddenBySuspension, false);
});

test("activation: a suspension that lands after the restore re-marks the now-public row (no interleave window)", () => {
  // Restore-first ordering: the restore makes the row publicly visible, and
  // the suspension's hide spec — running inside the same locked transaction
  // as the entitlement flip — re-marks it. Both orderings end non-public,
  // with no extra locks (the where-condition is atomic with each write).
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", isAvailable: false, hiddenBySubscription: true });

  assert.equal(store.applySpec(subscriptionActivationRestoreSpec("s1")), 1); // restore is public now
  const marked = store.applySpec(sellerSuspensionHideSpec("s1")); // suspension lands
  assert.equal(marked, 1, "suspension must mark the row the restore exposed");
  const l1 = store.listings.get("l1")!;
  assert.equal(l1.isAvailable, false);
  assert.equal(l1.hiddenBySuspension, true);
});

test("activation: a row hidden by BOTH subscription and suspension keeps both flags while suspended (untouched by activation)", () => {
  const store = new FakeListingStore();
  store.seedSellerProfile("s1", false); // suspended
  store.seedListing({ id: "l1", isAvailable: false, hiddenBySubscription: true, hiddenBySuspension: true });

  assert.equal(store.applySpec(subscriptionActivationRestoreSpec("s1")), 0, "activation must not touch rows of an inactive seller");
  const l1 = store.listings.get("l1")!;
  assert.equal(l1.isAvailable, false);
  assert.equal(l1.hiddenBySubscription, true, "webhook flag intact");
  assert.equal(l1.hiddenBySuspension, true, "suspension marker intact");
});

test("activation: for an ACTIVE seller, activation clears only the webhook flag — the suspension marker stays and keeps the row non-public", () => {
  // End-state the review asked to pin: a both-flag row's subscription flag
  // clears via a later activation while active (or admin enable after
  // unsuspend), but the suspension marker is owned by suspend/unsuspend, so
  // the row stays non-public throughout.
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", isAvailable: false, hiddenBySubscription: true, hiddenBySuspension: true }); // both flags, active

  const touched = store.applySpec(subscriptionActivationRestoreSpec("s1"));
  assert.equal(touched, 1);
  const l1 = store.listings.get("l1")!;
  assert.equal(l1.hiddenBySubscription, false, "webhook flag cleared");
  assert.equal(l1.hiddenBySuspension, true, "suspension marker untouched by the webhook");
  const publicIds = [...store.listings.values()].filter((l) => whereMatches(l, PUBLIC_LISTING_CONDITION, store.sellerProfiles)).map((l) => l.id);
  assert.deepEqual(publicIds, [], "row must stay non-public while the marker stands");
});

test("public visibility predicate excludes suspension-hidden rows", () => {
  const store = new FakeListingStore();
  store.seedListing({ id: "l1" }); // public
  store.seedListing({ id: "l2", isAvailable: false, hiddenBySuspension: true }); // suspended seller
  const publicIds = [...store.listings.values()]
    .filter((l) => whereMatches(l, PUBLIC_LISTING_CONDITION))
    .map((l) => l.id);
  assert.deepEqual(publicIds, ["l1"]);
});

// ---------------------------------------------------------------------------
// decideListingCapCreate — cap survives concurrent-create races
// ---------------------------------------------------------------------------

test("listing cap: unlimited (null) always allows", () => {
  assert.deepEqual(decideListingCapCreate(999, null), { allowed: true });
});

test("listing cap: under the limit allows, at/over the limit blocks", () => {
  assert.deepEqual(decideListingCapCreate(2, 3), { allowed: true });
  const blocked = decideListingCapCreate(3, 3);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.code, "LISTING_LIMIT_REACHED");
  assert.equal(decideListingCapCreate(4, 3).allowed, false);
});

test("listing cap: concurrent creates cannot both pass when serialized on a re-read count", () => {
  // Models the route's advisory-locked transaction: each create re-reads the
  // count INSIDE the lock before deciding, so two concurrent creates for the
  // same seller cannot both observe the pre-create count.
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", sellerId: "s1" });
  store.seedListing({ id: "l2", sellerId: "s1" });
  const limit = 3;

  // Serialized: txn A fully completes (count + insert) before txn B's count
  // read — this is what pg_advisory_xact_lock enforces across concurrent
  // requests for the same seller.
  const countA = store.listingsBySeller("s1").length; // 2
  const decisionA = decideListingCapCreate(countA, limit);
  assert.equal(decisionA.allowed, true);
  store.seedListing({ id: "l3", sellerId: "s1" }); // txn A inserts

  const countB = store.listingsBySeller("s1").length; // 3, re-read after A committed
  const decisionB = decideListingCapCreate(countB, limit);
  assert.equal(decisionB.allowed, false, "cap must hold even back-to-back with no gap");
});

test("listing cap: an UN-serialized count-then-create (the original bug) would exceed the cap", () => {
  // Negative control: demonstrates the race the lock closes. Both requests
  // read the SAME pre-create count (2) because neither re-reads inside a
  // lock, so both pass and both insert — 4 listings against a cap of 3. This
  // is the failure mode decideListingCapCreate alone cannot prevent; the
  // route's advisory lock is load-bearing, not decorative.
  const store = new FakeListingStore();
  store.seedListing({ id: "l1", sellerId: "s1" });
  store.seedListing({ id: "l2", sellerId: "s1" });
  const limit = 3;
  const staleCount = store.listingsBySeller("s1").length; // both requests read 2
  assert.equal(decideListingCapCreate(staleCount, limit).allowed, true);
  assert.equal(decideListingCapCreate(staleCount, limit).allowed, true);
  store.seedListing({ id: "l3", sellerId: "s1" });
  store.seedListing({ id: "l4", sellerId: "s1" });
  assert.equal(store.listingsBySeller("s1").length, 4, "cap of 3 was exceeded without serialization");
});

// ---------------------------------------------------------------------------
// decideSellerCreateEligibility — the suspension wall on the CREATE path
// (round-2 blocking item 1)
// ---------------------------------------------------------------------------

test("create eligibility: an inactive seller profile refuses with SELLER_SUSPENDED (plan state is irrelevant)", () => {
  // A suspended seller keeps role SELLER — the profile's isActive is the
  // suspension state — and must be refused even with an active plan.
  const suspended = decideSellerCreateEligibility({
    role: "SELLER",
    hasSellerProfile: true,
    sellerProfileIsActive: false,
  });
  assert.equal(suspended.allowed, false);
  assert.equal(suspended.allowed === false && suspended.code, "SELLER_SUSPENDED");

  // The admin-de-roled-and-suspended shape: role changed away AND profile
  // inactive. The profile state wins the message (suspension is the wall
  // that must hold).
  const suspendedAndDeRoled = decideSellerCreateEligibility({
    role: "BUYER",
    hasSellerProfile: true,
    sellerProfileIsActive: false,
  });
  assert.equal(suspendedAndDeRoled.allowed, false);
  assert.equal(suspendedAndDeRoled.allowed === false && suspendedAndDeRoled.code, "SELLER_SUSPENDED");
});

test("create eligibility: non-SELLER roles refuse with NOT_A_SELLER, so the create route cannot re-uplift them", () => {
  // The uplift gap: the route's auto-create must not resurrect seller
  // entitlement for a user an admin explicitly changed away from SELLER —
  // including never-a-seller users with no profile at all.
  for (const role of ["BUYER", "ADMIN"] as const) {
    const noProfile = decideSellerCreateEligibility({
      role,
      hasSellerProfile: false,
      sellerProfileIsActive: null,
    });
    assert.equal(noProfile.allowed, false, `${role} without profile must be refused`);
    assert.equal(noProfile.allowed === false && noProfile.code, "NOT_A_SELLER");
  }
  // An ADMIN with an existing (active) profile is still not entitled to
  // create: admin is not a seller.
  const adminWithProfile = decideSellerCreateEligibility({
    role: "ADMIN",
    hasSellerProfile: true,
    sellerProfileIsActive: true,
  });
  assert.equal(adminWithProfile.allowed, false);
  assert.equal(adminWithProfile.allowed === false && adminWithProfile.code, "NOT_A_SELLER");
});

test("create eligibility: an active SELLER may create, with or without a profile (bootstrap)", () => {
  assert.deepEqual(
    decideSellerCreateEligibility({ role: "SELLER", hasSellerProfile: true, sellerProfileIsActive: true }),
    { allowed: true }
  );
  // First creation after an admin (re)grants SELLER to a user with no
  // profile: the profile is bootstrapped inside the locked transaction —
  // without any role write.
  assert.deepEqual(
    decideSellerCreateEligibility({ role: "SELLER", hasSellerProfile: false, sellerProfileIsActive: null }),
    { allowed: true }
  );
});

test("create: a suspension committed between the route reads is caught by the in-transaction re-read (same-lock serialization)", () => {
  // Models the route's advisory-locked transaction: the create re-reads the
  // seller's role + profile INSIDE the lock, and the suspend transaction
  // holds the SAME lock while flipping — so a suspension that commits before
  // the create's lock window is visible to it, and one that commits after
  // cannot interleave between the re-read and the insert.
  const store = new FakeListingStore();
  store.seedSellerProfile("s1", true);

  // Route pre-read (outside the transaction): seller looks eligible.
  const pre = decideSellerCreateEligibility({
    role: "SELLER",
    hasSellerProfile: true,
    sellerProfileIsActive: store.sellerProfiles.get("s1")!.isActive,
  });
  assert.equal(pre.allowed, true);

  // Admin suspend holds the same lock and completes: flip + hide spec (0
  // public rows to hide).
  store.seedSellerProfile("s1", false);
  assert.equal(store.applySpec(sellerSuspensionHideSpec("s1")), 0);

  // Inside the locked transaction, the FRESH read sees the new state.
  const inTx = decideSellerCreateEligibility({
    role: "SELLER",
    hasSellerProfile: true,
    sellerProfileIsActive: store.sellerProfiles.get("s1")!.isActive,
  });
  assert.equal(inTx.allowed, false);
  assert.equal(inTx.allowed === false && inTx.code, "SELLER_SUSPENDED");
  assert.equal(store.listings.size, 0, "no listing was created for the suspended seller");
});

test("create: an UN-serialized eligibility read (the original gap) would land a public listing for a suspended seller", () => {
  // Negative control (mirrors the un-serialized cap test): a naive route
  // that decides eligibility only from a pre-transaction read and skips the
  // in-transaction re-check behaves like this — the stale read passes, the
  // suspension completes (nothing public to hide yet), and the insert lands
  // AFTER the suspension's hide spec ran, so the new row is publicly visible
  // with NO suspension marker. This is the state the in-transaction
  // eligibility re-read + the same advisory lock make impossible.
  const store = new FakeListingStore();
  store.seedSellerProfile("s1", true);

  const staleRead = decideSellerCreateEligibility({
    role: "SELLER",
    hasSellerProfile: true,
    sellerProfileIsActive: store.sellerProfiles.get("s1")!.isActive,
  });
  assert.equal(staleRead.allowed, true);

  // Suspension completes first (its hide spec has no publicly visible rows).
  store.seedSellerProfile("s1", false);
  assert.equal(store.applySpec(sellerSuspensionHideSpec("s1")), 0);

  // Naive insert from the stale decision (skip the re-check): the row lands
  // public and unmarked while the seller is suspended.
  store.seedListing({ id: "l-new", sellerId: "s1", isAvailable: true });
  const publicIds = [...store.listings.values()]
    .filter((l) => whereMatches(l, PUBLIC_LISTING_CONDITION, store.sellerProfiles))
    .map((l) => l.id);
  assert.deepEqual(publicIds, ["l-new"], "the gap: a public, unmarked listing of a suspended seller");
});

// ---------------------------------------------------------------------------
// decideListingDeletion + delete guard — explicit retention policy
// ---------------------------------------------------------------------------

test("deletion: any active-order count blocks deletion with ACTIVE code", () => {
  const blocked = decideListingDeletion(1, 1);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.code, "LISTING_HAS_ACTIVE_ORDERS");
  assert.equal(decideListingDeletion(3, 2).allowed, false);
});

test("deletion: historical-only orders block deletion with HISTORY code, not a 500", () => {
  const store = new FakeListingStore();
  store.seedListing();
  store.seedOrder({ status: "COMPLETED" });
  store.seedOrder({ status: "CANCELLED" });
  store.seedOrder({ status: "DECLINED" });
  assert.equal(store.activeOrderCount("l1"), 0);
  assert.equal(store.orderCount("l1"), 3);
  const decision = decideListingDeletion(store.orderCount("l1"), store.activeOrderCount("l1"));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "LISTING_HAS_ORDER_HISTORY");
});

test("deletion: no order history at all is deletable", () => {
  const store = new FakeListingStore();
  store.seedListing();
  assert.deepEqual(
    decideListingDeletion(store.orderCount("l1"), store.activeOrderCount("l1")),
    { allowed: true }
  );
});

test("deletion: new order placed between the pre-check and delete still blocks (locked re-check)", () => {
  const store = new FakeListingStore();
  store.seedListing();
  // Pre-check sees no orders at all...
  assert.deepEqual(
    decideListingDeletion(store.orderCount("l1"), store.activeOrderCount("l1")),
    { allowed: true }
  );
  // ...a buyer checks out right after (order created before the delete runs)...
  store.seedOrder({ status: "CONFIRMED" });
  // ...the locked re-check (same query rerun inside the transaction) must block.
  const decision = decideListingDeletion(store.orderCount("l1"), store.activeOrderCount("l1"));
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "LISTING_HAS_ACTIVE_ORDERS");
});

test("deletion guard spec is ownership-scoped", () => {
  // Mirrors the route's atomic deleteMany where: only the owner's listing
  // rows can be removed by a guarded delete.
  const store = new FakeListingStore();
  store.seedListing();
  assert.equal(
    whereMatches(store.listings.get("l1")!, { id: "l1", sellerId: "someone-else" }),
    false
  );
  assert.equal(
    whereMatches(store.listings.get("l1")!, { id: "l1", sellerId: "s1" }),
    true
  );
});

// ---------------------------------------------------------------------------
// sellerUpdateData — omission-safe partial update
// ---------------------------------------------------------------------------

test("partial update: omitted stockCount/photos/description are absent, not zeroed/wiped", () => {
  const data = sellerUpdateData(
    { title: "Fresh eggs", pricePerUnit: 5, unit: "DOZEN" },
    true
  );
  assert.equal("stockCount" in data, false, "omitted stockCount must not appear in the update data");
  assert.equal("photos" in data, false, "omitted photos must not appear in the update data");
  assert.equal("description" in data, false, "omitted description must not appear in the update data");
  assert.equal(data.title, "Fresh eggs");
  assert.equal(data.isAvailable, true, "isAvailable falls back to the current row value");
});

test("partial update: a stored stockCount survives an update that omits it", () => {
  const store = new FakeListingStore();
  store.seedListing({ stockCount: 12 });
  const data = sellerUpdateData(
    { title: "Fresh eggs", pricePerUnit: 5, unit: "DOZEN" },
    true
  );
  store.applySpec({ where: { id: "l1", sellerId: "s1" }, data });
  assert.equal(store.listings.get("l1")!.stockCount, 12, "stock must survive the omission, not become 0");
});

test("partial update: explicit null description clears it; omitted description preserves it", () => {
  const cleared = sellerUpdateData(
    { title: "t", pricePerUnit: 1, unit: "DOZEN", description: null },
    true
  );
  assert.equal(cleared.description, null);

  const preserved = sellerUpdateData({ title: "t", pricePerUnit: 1, unit: "DOZEN" }, true);
  assert.equal("description" in preserved, false);
});

test("partial update: custom unit fields follow the unit, not their own presence", () => {
  const custom = sellerUpdateData(
    {
      title: "t",
      pricePerUnit: 1,
      unit: "CUSTOM",
      customUnitName: "flat",
      customUnitQty: 30,
    },
    true
  );
  assert.equal(custom.customUnitName, "flat");
  assert.equal(custom.customUnitQty, 30);

  const switchedAway = sellerUpdateData({ title: "t", pricePerUnit: 1, unit: "DOZEN" }, true);
  assert.equal(switchedAway.customUnitName, null, "stale custom pricing is cleared on unit switch");
  assert.equal(switchedAway.customUnitQty, null);
});

test("partial update: explicit isAvailable overwrites; omitted preserves the current row value", () => {
  const explicit = sellerUpdateData(
    { title: "t", pricePerUnit: 1, unit: "DOZEN", isAvailable: false },
    true
  );
  assert.equal(explicit.isAvailable, false);

  const omitted = sellerUpdateData({ title: "t", pricePerUnit: 1, unit: "DOZEN" }, false);
  assert.equal(omitted.isAvailable, false, "preserves the current row value when the field is omitted");
});
