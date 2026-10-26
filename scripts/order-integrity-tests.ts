/**
 * Persistence-level regression tests for checkout/cancellation races and
 * refund/stock reconciliation.
 *
 * These drive the REAL flow modules (checkout-session, refund-reconciliation,
 * payment-integrity) against an in-memory persistence layer that enforces
 * Prisma-like conditional-update semantics: updateMany applies ONLY when every
 * where-field still equals the live row's value at update time, and tests
 * inject concurrent mutations at the exact race point (between the route's read
 * and its claim/update), so the interleavings the routes actually execute are
 * exercised rather than assumed.
 *
 * Run: node --import tsx --test scripts/order-integrity-tests.ts   (npm test)
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCumulativeRefund,
  checkoutClaimSpec,
  dollarsToCents,
  type OrderStatusName,
} from "../src/lib/payment-integrity";
import {
  createCheckoutForOrder,
  type CheckoutSessionCreateInput,
  type CheckoutSessionPorts,
} from "../src/lib/checkout-session";
import {
  applyRefundReconciliation,
  type RefundApplyPort,
  type RefundOrderSnapshot,
} from "../src/lib/refund-reconciliation";

// ---------------------------------------------------------------------------
// In-memory store with per-operation race injection
// ---------------------------------------------------------------------------

interface OrderRow {
  id: string;
  status: OrderStatusName;
  stripePaymentId: string | null;
  checkoutSessionId: string | null;
  refundedCents: number;
  totalPrice: number;
  listingId: string;
  quantity: number;
}

interface ListingRow {
  id: string;
  stockCount: number;
}

interface SessionRow {
  id: string;
  url: string | null;
  status: string;
}

type AnyRow = Record<string, unknown>;

/** Conditional update with Prisma updateMany semantics: ALL where-fields must
 * still equal the LIVE row at update time, or nothing is written. */
function applyGuardedOrderUpdate(
  store: FakeStore,
  spec: { where: Record<string, unknown>; data: Record<string, unknown> },
): number {
  const row = store.orders.get(spec.where.id as string) as AnyRow | undefined;
  if (!row) return 0;
  for (const [field, expected] of Object.entries(spec.where)) {
    if (row[field] !== expected) return 0;
  }
  for (const [field, value] of Object.entries(spec.data)) {
    row[field] = value;
  }
  return 1;
}

class FakeStore {
  orders = new Map<string, OrderRow>();
  listings = new Map<string, ListingRow>();
  sessions = new Map<string, SessionRow>();
  audit: Array<{ fromStatus: string; toStatus: string; refundedCents: number }> = [];
  expiredSessions: string[] = [];
  stockRestores = 0;

  seedOrder(over: Partial<OrderRow> = {}): OrderRow {
    const row: OrderRow = {
      id: "o1",
      status: "CONFIRMED",
      stripePaymentId: null,
      checkoutSessionId: null,
      refundedCents: 0,
      totalPrice: 10.0,
      listingId: "l1",
      quantity: 2,
      ...over,
    };
    this.orders.set(row.id, row);
    return row;
  }

  seedListing(over: Partial<ListingRow> = {}): ListingRow {
    const row: ListingRow = { id: "l1", stockCount: 5, ...over };
    this.listings.set(row.id, row);
    return row;
  }

  seedSession(over: Partial<SessionRow> = {}): SessionRow {
    const row: SessionRow = {
      id: `cs_${this.sessions.size + 1}`,
      url: `https://pay.example/${this.sessions.size + 1}`,
      status: "open",
      ...over,
    };
    this.sessions.set(row.id, row);
    return row;
  }

  expireSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.status = "expired";
    this.expiredSessions.push(sessionId);
  }

  restoreStock(listingId: string, quantity: number): void {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`listing ${listingId} missing`);
    listing.stockCount += quantity;
    this.stockRestores += 1;
  }
}

/** Ports for createCheckoutForOrder bound to the store; `afterFind(callN)`
 * runs after the Nth findOrder snapshot is taken — the race window. */
function checkoutPorts(
  store: FakeStore,
  afterFind?: (call: number) => void
): CheckoutSessionPorts {
  let findCalls = 0;
  return {
    findOrder: async (id) => {
      findCalls += 1;
      const row = store.orders.get(id);
      const snapshot = row ? { ...row } : null;
      // A concurrent mutation lands AFTER our read but BEFORE the next DB op —
      // the exact interleaving a real route executes.
      afterFind?.(findCalls);
      return snapshot;
    },
    retrieveSession: async (id) => store.sessions.get(id) ?? null,
    createSession: async () => store.seedSession({ status: "open" }),
    claimSession: async (spec) => applyGuardedOrderUpdate(store, spec),
    expireSession: async (id) => store.expireSession(id),
  };
}

function checkoutInput(orderId = "o1"): CheckoutSessionCreateInput {
  return {
    orderId,
    amountCents: dollarsToCents(10.0),
    platformFeeCents: dollarsToCents(0.5),
    sellerAccount: null,
    baseUrl: "https://eggbook.test",
  };
}

function refundApplyPort(store: FakeStore, onRestore?: () => void): RefundApplyPort {
  return {
    updateOrderGuarded: async (spec) => applyGuardedOrderUpdate(store, spec),
    restoreStock: async (listingId, quantity) => {
      store.restoreStock(listingId, quantity);
      onRestore?.();
    },
    logAudit: async (entry) => {
      store.audit.push(entry);
    },
  };
}

/** The webhook/admin reconcile inputs, computed by the REAL table. */
function snapshotOf(row: OrderRow): RefundOrderSnapshot {
  return {
    id: row.id,
    status: row.status,
    refundedCents: row.refundedCents,
    listingId: row.listingId,
    quantity: row.quantity,
  };
}

function reconcile(row: OrderRow, cumulativeRefundedCents: number) {
  return applyCumulativeRefund(
    {
      status: row.status,
      amountCents: Math.round(row.totalPrice * 100),
      refundedCents: row.refundedCents,
    },
    cumulativeRefundedCents
  );
}

// ---------------------------------------------------------------------------
// Checkout session vs cancellation/payment interleavings
// ---------------------------------------------------------------------------

test("checkout claim requires the order's current status (cancel race is lost, session expires, no URL)", async () => {
  // The regression: without the status guard in the claim, a cancellation that
  // won between the read and the claim used to gain a payable session anyway.
  const store = new FakeStore();
  store.seedOrder();
  let cancelled = false;
  const ports = checkoutPorts(store, (call) => {
    // Seller cancels the order in the gap between our read and our claim.
    if (call === 1 && !cancelled) {
      cancelled = true;
      store.orders.get("o1")!.status = "CANCELLED";
    }
  });

  const result = await createCheckoutForOrder(checkoutInput(), ports);

  assert.equal(result.kind, "error");
  assert.ok(
    result.kind === "error" && result.error.includes("confirmed"),
    `expected the not-payable rejection, got ${JSON.stringify(result)}`
  );
  const row = store.orders.get("o1")!;
  assert.equal(row.status, "CANCELLED");
  assert.equal(row.checkoutSessionId, null); // cancelled order never gains a session
  assert.deepEqual(store.expiredSessions, ["cs_1"]); // minted session expired
  assert.equal(store.sessions.get("cs_1")?.status, "expired");
});

test("checkout claim loses to a webhook payment: no second session, buyer not charged twice", async () => {
  const store = new FakeStore();
  store.seedOrder();
  let paid = false;
  const ports = checkoutPorts(store, (call) => {
    if (call === 1 && !paid) {
      paid = true;
      const row = store.orders.get("o1")!;
      row.status = "PAID";
      row.stripePaymentId = "pi_webhook_1"; // webhook attach won the race
    }
  });

  const result = await createCheckoutForOrder(checkoutInput(), ports);

  assert.ok(result.kind === "error" && result.error.includes("already been paid"));
  const row = store.orders.get("o1")!;
  assert.equal(row.checkoutSessionId, null); // no session attaches to a paid order
  assert.equal(row.stripePaymentId, "pi_webhook_1");
  assert.deepEqual(store.expiredSessions, ["cs_1"]);
});

test("simultaneous creators: loser expires its session and returns the winner's URL", async () => {
  const store = new FakeStore();
  store.seedOrder();
  const winner = store.seedSession({ id: "cs_winner", url: "https://pay.example/winner" });
  let twinClaimed = false;
  const ports = checkoutPorts(store, (call) => {
    if (call === 1 && !twinClaimed) {
      twinClaimed = true;
      // The twin request created its session and claimed the slot first.
      store.orders.get("o1")!.checkoutSessionId = winner.id;
    }
  });

  const result = await createCheckoutForOrder(checkoutInput(), ports);

  assert.ok(result.kind === "url");
  assert.ok(result.kind === "url" && result.url === winner.url);
  const row = store.orders.get("o1")!;
  assert.equal(row.checkoutSessionId, "cs_winner"); // winner's claim stands
  assert.deepEqual(store.expiredSessions, ["cs_2"]); // loser's minted session expired
});

test("loser of the session slot with a completed winner session gets no payable URL", async () => {
  const store = new FakeStore();
  store.seedOrder();
  const winner = store.seedSession({ id: "cs_winner", status: "complete" });
  const ports = checkoutPorts(store, (call) => {
    if (call === 1) store.orders.get("o1")!.checkoutSessionId = winner.id;
  });

  const result = await createCheckoutForOrder(checkoutInput(), ports);

  assert.ok(result.kind === "error" && result.error.includes("could not be settled"));
  assert.deepEqual(store.expiredSessions, ["cs_2"]); // loser's minted session expired
  assert.equal(result.kind === "error" && "url" in result, false);
});

test("reuse path: a cancelled order never receives its still-open stored session", async () => {
  // Regression for charged-but-cancelled: Stripe's best-effort expiry can fail,
  // leaving the stored session 'open' — the route must still refuse to return
  // the URL once the order has left the payable state.
  const store = new FakeStore();
  const stored = store.seedSession({ id: "cs_open" });
  store.seedOrder({ checkoutSessionId: stored.id });
  let cancelled = false;
  const ports = checkoutPorts(store, (call) => {
    if (call === 1 && !cancelled) {
      cancelled = true;
      store.orders.get("o1")!.status = "CANCELLED";
    }
  });

  const result = await createCheckoutForOrder(checkoutInput(), ports);

  assert.ok(result.kind === "error" && result.error.includes("confirmed"));
  assert.equal(
    result.kind === "error" && "url" in result,
    false,
    "no url may be handed out for a cancelled order"
  );
  const row = store.orders.get("o1")!;
  assert.equal(row.status, "CANCELLED");
  assert.equal(row.stripePaymentId, null); // nothing was charged
});

test("reuse path: retry before any race returns the same open session (idempotent)", async () => {
  const store = new FakeStore();
  const stored = store.seedSession({ id: "cs_open" });
  store.seedOrder({ checkoutSessionId: stored.id });

  const result = await createCheckoutForOrder(checkoutInput(), checkoutPorts(store));

  assert.ok(result.kind === "url");
  assert.ok(result.kind === "url" && result.url === stored.url);
  assert.equal(store.orders.get("o1")!.checkoutSessionId, "cs_open");
  assert.deepEqual(store.expiredSessions, []); // nothing minted, nothing to expire
});

test("create path: a normal uncontended checkout claims the session and returns its URL", async () => {
  const store = new FakeStore();
  store.seedOrder();

  const result = await createCheckoutForOrder(checkoutInput(), checkoutPorts(store));

  assert.ok(result.kind === "url");
  assert.ok(result.kind === "url" && result.url === store.sessions.get("cs_1")?.url);
  const row = store.orders.get("o1")!;
  assert.equal(row.checkoutSessionId, "cs_1");
  assert.equal(row.status, "CONFIRMED");
  assert.deepEqual(store.expiredSessions, []);
});

test("the shared claim spec gates on the order's current CONFIRMED status", () => {
  const fresh = checkoutClaimSpec("o1", null, "cs_new");
  assert.deepEqual(fresh.where, {
    id: "o1",
    checkoutSessionId: null,
    status: "CONFIRMED",
  });
  assert.deepEqual(fresh.data, { checkoutSessionId: "cs_new" });
  const retry = checkoutClaimSpec("o1", "cs_old", "cs_new");
  assert.equal(retry.where.status, "CONFIRMED"); // the status guard is not optional
});

// ---------------------------------------------------------------------------
// Refund reconciliation: persistence-level refund/stock invariants
// ---------------------------------------------------------------------------

test("partial refund keeps the order PAID and never touches stock", async () => {
  const store = new FakeStore();
  store.seedOrder({ status: "PAID", stripePaymentId: "pi_1" });
  store.seedListing();
  const row = store.orders.get("o1")!;

  const transition = reconcile(row, 400); // Stripe: charge.amount_refunded = 400
  assert.ok(transition);
  assert.equal(transition!.status, "PAID");
  assert.equal(transition!.restoreStock, false);

  const outcome = await applyRefundReconciliation(snapshotOf(row), transition!, refundApplyPort(store));

  assert.equal(outcome.applied, true);
  const after = store.orders.get("o1")!;
  assert.equal(after.status, "PAID");
  assert.equal(after.refundedCents, 400);
  assert.equal(store.stockRestores, 0);
  assert.equal(store.listings.get("l1")!.stockCount, 5);
  assert.deepEqual(store.audit, [
    { fromStatus: "PAID", toStatus: "PAID", refundedCents: 400 },
  ]);
});

test("full refund cancels once and restores stock exactly once", async () => {
  const store = new FakeStore();
  store.seedOrder({ status: "PAID", stripePaymentId: "pi_1", refundedCents: 400 });
  store.seedListing();
  const row = store.orders.get("o1")!;

  const transition = reconcile(row, 1000); // now fully refunded (amountCents = 1000)
  assert.ok(transition && transition.status === "CANCELLED" && transition.restoreStock === true);

  const outcome = await applyRefundReconciliation(snapshotOf(row), transition!, refundApplyPort(store));

  assert.equal(outcome.applied, true);
  const after = store.orders.get("o1")!;
  assert.equal(after.status, "CANCELLED");
  assert.equal(after.refundedCents, 1000);
  assert.equal(store.stockRestores, 1); // exactly one inventory give-back
  assert.equal(store.listings.get("l1")!.stockCount, 7); // 5 + quantity 2
  assert.ok(store.audit[0].toStatus === "CANCELLED");
});

test("a refund event that lost the compare-and-set never restores stock", async () => {
  // Concurrent reconciliation moved the order between our reconcile and our
  // guarded update: the snapshot no longer matches, so NOTHING may apply —
  // this is the double-restore / double-count guard at the persistence layer.
  const store = new FakeStore();
  store.seedOrder({ status: "CANCELLED", stripePaymentId: "pi_1", refundedCents: 1000 });
  store.seedListing({ stockCount: 7 });
  const staleRow = store.orders.get("o1")!;
  const snapshot: RefundOrderSnapshot = {
    id: staleRow.id,
    status: "PAID", // computed against the pre-webhook state
    refundedCents: 400,
    listingId: staleRow.listingId,
    quantity: staleRow.quantity,
  };
  const transition = reconcile(
    { ...staleRow, status: "PAID", refundedCents: 400 },
    1000
  );
  assert.ok(transition && transition.restoreStock === true);

  const outcome = await applyRefundReconciliation(snapshot, transition!, refundApplyPort(store));

  assert.equal(outcome.applied, false);
  const after = store.orders.get("o1")!;
  assert.equal(after.status, "CANCELLED");
  assert.equal(after.refundedCents, 1000); // untouched live state
  assert.equal(store.stockRestores, 0); // no second inventory give-back
  assert.equal(store.listings.get("l1")!.stockCount, 7);
  assert.deepEqual(store.audit, []); // no audit row for a no-op apply
});

test("replayed refund events are idempotent: reconcile returns null and nothing is applied", async () => {
  const store = new FakeStore();
  store.seedOrder({ status: "CANCELLED", stripePaymentId: "pi_1", refundedCents: 1000 });
  store.seedListing({ stockCount: 7 });
  const row = store.orders.get("o1")!;

  let applies = 0;
  refundApplyPort(store, () => {
    applies += 1;
  });

  const transition = reconcile(row, 1000); // Stripe replays amount_refunded = 1000
  assert.equal(transition, null); // nothing would change — webhook skips entirely
  assert.equal(applies, 0);
  assert.equal(store.orders.get("o1")!.refundedCents, 1000);
  assert.equal(store.listings.get("l1")!.stockCount, 7);
  assert.deepEqual(store.audit, []);
});

test("a fully refunded COMPLETED order cancels but does not restore stock", async () => {
  const store = new FakeStore();
  store.seedOrder({ status: "COMPLETED", stripePaymentId: "pi_1" });
  store.seedListing();
  const row = store.orders.get("o1")!;

  const transition = reconcile(row, 1000);
  assert.ok(transition && transition.status === "CANCELLED");
  assert.equal(transition!.restoreStock, false); // fulfilled goods never restock

  const outcome = await applyRefundReconciliation(snapshotOf(row), transition!, refundApplyPort(store));

  assert.equal(outcome.applied, true);
  assert.equal(store.orders.get("o1")!.status, "CANCELLED");
  assert.equal(store.stockRestores, 0);
  assert.equal(store.listings.get("l1")!.stockCount, 5);
});

test("a late refund event for an already-cancelled order only tracks the balance", async () => {
  // Admin cancelled, refund arrives afterwards: cumulative balance may move,
  // but inventory must not be duplicated again.
  const store = new FakeStore();
  store.seedOrder({ status: "CANCELLED", stripePaymentId: "pi_1", refundedCents: 400 });
  store.seedListing({ stockCount: 7 });
  const row = store.orders.get("o1")!;

  const transition = reconcile(row, 700); // residual refund arrives
  assert.ok(transition);
  assert.equal(transition!.status, "CANCELLED");
  assert.equal(transition!.restoreStock, false);

  const outcome = await applyRefundReconciliation(
    snapshotOf(row),
    transition!,
    refundApplyPort(store),
    { cancelReason: "Refunded" }
  );

  assert.equal(outcome.applied, true);
  const after = store.orders.get("o1")!;
  assert.equal(after.status, "CANCELLED");
  assert.equal(after.refundedCents, 700);
  assert.equal(store.stockRestores, 0);
  assert.equal(store.listings.get("l1")!.stockCount, 7);
});