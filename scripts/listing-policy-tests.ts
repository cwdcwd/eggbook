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
  decideListingDeletion,
  decideOrderPlacement,
  decideSellerRelist,
  orderStockClaimSpec,
  sellerRelistWhereGuard,
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

function whereMatches(row: ListingRow, where: Record<string, unknown>): boolean {
  for (const [field, expected] of Object.entries(where)) {
    // Prisma field-filter shape (e.g. { gte: n }) vs. literal value
    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      const filter = expected as Record<string, number>;
      if (typeof row[field as keyof ListingRow] !== "number") return false;
      const value = row[field as keyof ListingRow] as number;
      if ("gte" in filter && value < filter.gte) return false;
      continue;
    }
    if (row[field as keyof ListingRow] !== expected) return false;
  }
  return true;
}

class FakeListingStore {
  listings = new Map<string, ListingRow>();
  orders = new Map<string, OrderRow>();

  seedListing(over: Partial<ListingRow> = {}): ListingRow {
    const row: ListingRow = {
      id: "l1",
      sellerId: "s1",
      stockCount: 5,
      isAvailable: true,
      hiddenBySubscription: false,
      ...over,
    };
    this.listings.set(row.id, row);
    return row;
  }

  seedOrder(over: Partial<OrderRow> = {}): OrderRow {
    const row: OrderRow = { id: `o${this.orders.size + 1}`, listingId: "l1", status: "PENDING", ...over };
    this.orders.set(row.id, row);
    return row;
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

  /**
   * Prisma updateMany semantics: ALL where-fields must still equal the live
   * row, and data supports the increment/decrement field operations.
   */
  applySpec(spec: { where: Record<string, unknown>; data: Record<string, unknown> }): number {
    const row = this.listings.get(spec.where.id as string);
    if (!row || !whereMatches(row, spec.where)) return 0;
    const writable = row as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(spec.data)) {
      if (value !== null && typeof value === "object") {
        // Prisma numeric field operation: { increment: n } / { decrement: n }
        const op = value as Record<string, number>;
        const current = writable[field] as unknown;
        if (typeof current !== "number") return 0;
        if ("increment" in op) writable[field] = current + op.increment;
        else if ("decrement" in op) writable[field] = current - op.decrement;
        else return 0; // test store never intends other operators
      } else {
        writable[field] = value;
      }
    }
    return 1;
  }
}

// Route-shaped relist used by every relist test below (mirrors the PUT where/
// data exactly, so the guard fragments stay honest). `interleave` runs between
// the route's pre-check and its guard-write, like a concurrent webhook firing.
function sellerRelist(
  store: FakeListingStore,
  listingId: string,
  sellerId: string,
  interleave?: () => void
) {
  const current = store.listings.get(listingId);
  assert.ok(current, "relist target must exist in test store");
  const precheck = decideSellerRelist(
    { isAvailable: current.isAvailable, hiddenBySubscription: current.hiddenBySubscription },
    true
  );
  if (!precheck.allowed) return precheck;

  interleave?.();

  const spec = {
    where: { id: listingId, sellerId, ...sellerRelistWhereGuard() },
    data: { isAvailable: true, hiddenBySubscription: false },
  };
  const applied = store.applySpec(spec);
  if (applied === 0) {
    const after = store.listings.get(listingId);
    throw new Error(
      after && after.hiddenBySubscription ? "HIDDEN_BY_SUBSCRIPTION" : "NOT_AUTHORIZED"
    );
  }
  return precheck;
}

// ---------------------------------------------------------------------------
// decideOrderPlacement — buyer rules
// ---------------------------------------------------------------------------

test("order placement: subscription-hidden listings are unsellable", () => {
  const decision = decideOrderPlacement(
    { isAvailable: true, hiddenBySubscription: true, stockCount: 10 },
    1
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "LISTING_UNAVAILABLE");
});

test("order placement: seller-disabled listings are unsellable", () => {
  const decision = decideOrderPlacement(
    { isAvailable: false, hiddenBySubscription: false, stockCount: 10 },
    1
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "LISTING_UNAVAILABLE");
});

test("order placement: insufficient stock is distinct from unavailable", () => {
  const decision = decideOrderPlacement(
    { isAvailable: true, hiddenBySubscription: false, stockCount: 2 },
    3
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.code, "INSUFFICIENT_STOCK");
  assert.equal(decision.allowed === false && decision.message, "Not enough stock");
});

test("order placement: public stocked listing is sellable", () => {
  assert.deepEqual(
    decideOrderPlacement({ isAvailable: true, hiddenBySubscription: false, stockCount: 5 }, 5),
    { allowed: true }
  );
});

// ---------------------------------------------------------------------------
// orderStockClaimSpec — atomic claim carries the visibility guard
// ---------------------------------------------------------------------------

test("stock claim spec guards on visibility, subscription flag, and stock", () => {
  const spec = orderStockClaimSpec("l1", 2);
  assert.deepEqual(spec, {
    where: {
      id: "l1",
      stockCount: { gte: 2 },
      isAvailable: true,
      hiddenBySubscription: false,
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
      { isAvailable: listing.isAvailable, hiddenBySubscription: listing.hiddenBySubscription, stockCount: listing.stockCount },
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
    { isAvailable: false, hiddenBySubscription: true },
    true
  );
  assert.equal(decision.allowed, false);
  assert.equal(
    decision.allowed === false && decision.code,
    "LISTING_HIDDEN_BY_SUBSCRIPTION"
  );
});

test("seller relist: edits without a visibility flip stay allowed while hidden", () => {
  assert.deepEqual(
    decideSellerRelist({ isAvailable: false, hiddenBySubscription: true }, undefined),
    { allowed: true }
  );
  assert.deepEqual(
    decideSellerRelist({ isAvailable: false, hiddenBySubscription: true }, false),
    { allowed: true }
  );
});

test("seller relist: normal pause/restore of a non-hidden listing is allowed", () => {
  assert.deepEqual(
    decideSellerRelist({ isAvailable: false, hiddenBySubscription: false }, true),
    { allowed: true }
  );
  assert.deepEqual(
    decideSellerRelist({ isAvailable: true, hiddenBySubscription: false }, true),
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
    { isAvailable: store.listings.get("l1")!.isAvailable, hiddenBySubscription: false },
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

test("seller relist: cross-seller relist claims nothing (ownership guard)", () => {
  const store = new FakeListingStore();
  store.seedListing({ isAvailable: false, hiddenBySubscription: false });
  assert.throws(() => sellerRelist(store, "l1", "s2"), /NOT_AUTHORIZED/);
  assert.equal(store.listings.get("l1")!.isAvailable, false);
});

// ---------------------------------------------------------------------------
// decideListingDeletion + delete guard
// ---------------------------------------------------------------------------

test("deletion: any active-order count blocks deletion", () => {
  const blocked = decideListingDeletion(1);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.code, "LISTING_HAS_ACTIVE_ORDERS");
  assert.equal(decideListingDeletion(3).allowed, false);
});

test("deletion: fulfilled/cancelled orders do not block deletion", () => {
  const store = new FakeListingStore();
  store.seedListing();
  store.seedOrder({ status: "COMPLETED" });
  store.seedOrder({ status: "CANCELLED" });
  store.seedOrder({ status: "DECLINED" });
  assert.equal(store.activeOrderCount("l1"), 0);
  assert.deepEqual(decideListingDeletion(store.activeOrderCount("l1")), { allowed: true });
});

test("deletion: new order placed between the pre-check and delete still blocks (locked re-check)", () => {
  const store = new FakeListingStore();
  store.seedListing();
  // Pre-check sees no active orders...
  assert.deepEqual(decideListingDeletion(store.activeOrderCount("l1")), { allowed: true });
  // ...a buyer checks out right after (order created before the delete runs)...
  store.seedOrder({ status: "CONFIRMED" });
  // ...the locked re-check (same query rerun inside the transaction) must block.
  assert.equal(
    decideListingDeletion(store.activeOrderCount("l1")).allowed,
    false
  );
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
// Public visibility predicate
// ---------------------------------------------------------------------------

test("public listing condition hides unavailable and subscription-hidden rows", () => {
  assert.deepEqual(PUBLIC_LISTING_CONDITION, {
    isAvailable: true,
    hiddenBySubscription: false,
  });
  const store = new FakeListingStore();
  store.seedListing(); // public
  store.seedListing({ id: "l2", isAvailable: true, hiddenBySubscription: true }); // subscription-hidden
  store.seedListing({ id: "l3", isAvailable: false, hiddenBySubscription: false }); // seller-disabled
  const publicIds = [...store.listings.values()]
    .filter((l) => whereMatches(l, PUBLIC_LISTING_CONDITION))
    .map((l) => l.id);
  assert.deepEqual(publicIds, ["l1"]);
});