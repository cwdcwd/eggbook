import assert from "node:assert/strict";
import test from "node:test";
import {
  dollarsToCents,
  centsToDollars,
  nextRefundState,
} from "../src/lib/payment-integrity";

test("money converts decimal dollars to exact integer cents", () => {
  assert.equal(dollarsToCents(12.34), 1234);
  assert.equal(dollarsToCents(0.1 + 0.2), 30);
  assert.equal(dollarsToCents(0), 0);
});

test("money rejects non-finite, negative, and fractional-cent amounts", () => {
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.001]) {
    assert.throws(() => dollarsToCents(amount));
  }
});

test("cents convert back to dollars without binary arithmetic", () => {
  assert.equal(centsToDollars(1234), 12.34);
  assert.throws(() => centsToDollars(1.2));
});

test("partial refund preserves order status and stock; full refund cancels once", () => {
  assert.deepEqual(nextRefundState({ status: "PAID", amountCents: 1000, refundedCents: 0 }, 400), {
    status: "PAID", refundedCents: 400, restoreStock: false,
  });
  assert.deepEqual(nextRefundState({ status: "PAID", amountCents: 1000, refundedCents: 400 }, 600), {
    status: "CANCELLED", refundedCents: 1000, restoreStock: true,
  });
  assert.deepEqual(nextRefundState({ status: "COMPLETED", amountCents: 1000, refundedCents: 0 }, 1000), {
    status: "CANCELLED", refundedCents: 1000, restoreStock: false,
  });
});

test("refund state rejects over-refunds and non-refundable orders", () => {
  assert.throws(() => nextRefundState({ status: "PAID", amountCents: 1000, refundedCents: 900 }, 101));
  assert.throws(() => nextRefundState({ status: "CANCELLED", amountCents: 1000, refundedCents: 0 }, 100));
});
import {
  applyCumulativeRefund,
  isTransitionAllowed,
  nextAdminStatus,
  nextCheckoutAction,
  paymentEventAction,
} from "../src/lib/payment-integrity";

test("webhook reconciliation is idempotent and order-preserving", () => {
  // first partial refund event
  assert.deepEqual(applyCumulativeRefund({ status: "PAID", amountCents: 1000, refundedCents: 0 }, 400), {
    status: "PAID", refundedCents: 400, restoreStock: false,
  });
  // replayed/out-of-order events change nothing
  assert.equal(applyCumulativeRefund({ status: "PAID", amountCents: 1000, refundedCents: 400 }, 400), null);
  assert.equal(applyCumulativeRefund({ status: "PAID", amountCents: 1000, refundedCents: 400 }, 200), null);
  // cumulative reaching the full amount cancels exactly once and restores stock once
  assert.deepEqual(applyCumulativeRefund({ status: "PAID", amountCents: 1000, refundedCents: 400 }, 1000), {
    status: "CANCELLED", refundedCents: 1000, restoreStock: true,
  });
  // a second event on an already-cancelled order never restores stock again
  assert.deepEqual(applyCumulativeRefund({ status: "CANCELLED", amountCents: 1000, refundedCents: 1000 }, 1000), null);
  assert.deepEqual(applyCumulativeRefund({ status: "CANCELLED", amountCents: 1000, refundedCents: 1000 }, 0), null);
  // completed orders keep status on partial refunds and never restore stock
  assert.deepEqual(applyCumulativeRefund({ status: "COMPLETED", amountCents: 1000, refundedCents: 0 }, 300), {
    status: "COMPLETED", refundedCents: 300, restoreStock: false,
  });
  assert.deepEqual(applyCumulativeRefund({ status: "COMPLETED", amountCents: 1000, refundedCents: 300 }, 1000), {
    status: "CANCELLED", refundedCents: 1000, restoreStock: false,
  });
  assert.throws(() => applyCumulativeRefund({ status: "PAID", amountCents: 1000, refundedCents: 0 }, 1001));
});

test("seller transition table blocks payment-destructive transitions", () => {
  assert.equal(isTransitionAllowed("confirm", "PENDING"), true);
  assert.equal(isTransitionAllowed("decline", "PENDING"), true);
  assert.equal(isTransitionAllowed("cancel", "CONFIRMED"), true);
  assert.equal(isTransitionAllowed("markPaid", "CONFIRMED"), true);
  assert.equal(isTransitionAllowed("complete", "CONFIRMED"), true);
  assert.equal(isTransitionAllowed("complete", "PAID"), true);
  // paid orders must keep their recorded payment until refunded
  assert.equal(isTransitionAllowed("markPaid", "PAID"), false);
  assert.equal(isTransitionAllowed("cancel", "PAID"), false);
  assert.equal(isTransitionAllowed("complete", "CANCELLED"), false);
  assert.equal(isTransitionAllowed("confirm", "CONFIRMED"), false);
});

test("admin overrides cannot resurrect terminal orders or create charged-but-cancelled states", () => {
  assert.deepEqual(nextAdminStatus("PENDING", "DECLINED", false), { allowed: true });
  assert.deepEqual(nextAdminStatus("CONFIRMED", "COMPLETED", false), { allowed: true });
  assert.deepEqual(nextAdminStatus("PAID", "COMPLETED", true), { allowed: true });
  // paid orders exit PAID only through the refund endpoint
  assert.equal(nextAdminStatus("PAID", "CANCELLED", true).allowed, false);
  assert.equal(nextAdminStatus("PAID", "DECLINED", true).allowed, false);
  assert.equal(nextAdminStatus("PAID", "CONFIRMED", true).allowed, false);
  // charged orders in any status cannot be force-cancelled, ever
  assert.equal(nextAdminStatus("CONFIRMED", "CANCELLED", true).allowed, false);
  // terminal states are immutable
  for (const target of ["CONFIRMED", "COMPLETED", "CANCELLED", "DECLINED"]) {
    assert.equal(nextAdminStatus("CANCELLED", target, true).allowed, false);
    assert.equal(nextAdminStatus("DECLINED", target, true).allowed, false);
    assert.equal(nextAdminStatus("COMPLETED", target, true).allowed, false);
  }
  assert.equal(nextAdminStatus("PAID", "CANCELLED", false).allowed, false);
});

test("checkout decisions are idempotent per order", () => {
  // already paid (or paid family) orders reject outright
  assert.equal(nextCheckoutAction({ status: "PAID", stripePaymentId: null }), "reject-paid");
  assert.equal(nextCheckoutAction({ status: "CONFIRMED", stripePaymentId: "pi_1" }), "reject-paid");
  assert.equal(nextCheckoutAction({ status: "COMPLETED", stripePaymentId: null }), "reject-paid");
  // must be seller-confirmed before payment
  assert.equal(nextCheckoutAction({ status: "PENDING", stripePaymentId: null }), "reject-status");
  assert.equal(nextCheckoutAction({ status: "CANCELLED", stripePaymentId: null }), "reject-status");
  // refresh/retry on the same open session returns the same session
  assert.equal(nextCheckoutAction({ status: "CONFIRMED", stripePaymentId: null }, "open"), "reuse");
  // a completed session belongs to an in-flight payment — refuse a duplicate session
  assert.equal(nextCheckoutAction({ status: "CONFIRMED", stripePaymentId: null }, "complete"), "reject-completed-session");
  // expired/failed/absent sessions allow a fresh one
  assert.equal(nextCheckoutAction({ status: "CONFIRMED", stripePaymentId: null }, "expired"), "create");
  assert.equal(nextCheckoutAction({ status: "CONFIRMED", stripePaymentId: null }, null), "create");
});

test("webhook payment attach never resurrects cancelled orders", () => {
  assert.equal(paymentEventAction("CONFIRMED"), "attach-and-advance");
  assert.equal(paymentEventAction("PAID"), "attach-only");
  assert.equal(paymentEventAction("COMPLETED"), "attach-only");
  for (const status of ["PENDING", "CANCELLED", "DECLINED"]) {
    assert.equal(paymentEventAction(status), "skip");
  }
});
