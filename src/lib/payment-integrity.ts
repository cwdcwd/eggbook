export type RefundableStatus = "PAID" | "COMPLETED" | "CANCELLED";

export interface RefundSnapshot {
  status: RefundableStatus;
  amountCents: number;
  refundedCents: number;
}

export interface RefundTransition {
  status: "PAID" | "CANCELLED";
  refundedCents: number;
  restoreStock: boolean;
}

/** Convert dollars to Stripe/database minor units without float multiplication drift. */
export function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("Amount must be a finite non-negative number");
  }
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (Math.abs(amount * 100 - cents) > 1e-7) {
    throw new RangeError("Amount must have no more than two decimal places");
  }
  return cents;
}

export function centsToDollars(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError("Cents must be a non-negative safe integer");
  }
  return cents / 100;
}

/** Apply a successful refund to the order's cumulative refund balance. */
export function nextRefundState(
  order: RefundSnapshot,
  refundCents: number,
): RefundTransition {
  if (!Number.isSafeInteger(order.amountCents) || order.amountCents <= 0 ||
      !Number.isSafeInteger(order.refundedCents) || order.refundedCents < 0 ||
      !Number.isSafeInteger(refundCents) || refundCents <= 0) {
    throw new RangeError("Refund amounts must be positive integer cents");
  }
  if (order.status !== "PAID" && order.status !== "COMPLETED") {
    throw new Error("Order is not refundable");
  }
  const refundedCents = order.refundedCents + refundCents;
  if (refundedCents > order.amountCents) {
    throw new RangeError("Refund exceeds remaining paid amount");
  }
  const fullyRefunded = refundedCents === order.amountCents;
  return {
    status: fullyRefunded ? "CANCELLED" : "PAID",
    refundedCents,
    restoreStock: fullyRefunded && order.status !== "COMPLETED",
  };
}

// ---------------------------------------------------------------------------
// Order action transitions (seller/buyer action endpoint)
// ---------------------------------------------------------------------------

export type OrderStatusName =
  | "PENDING"
  | "CONFIRMED"
  | "PAID"
  | "COMPLETED"
  | "CANCELLED"
  | "DECLINED";

export type OrderActionName =
  | "confirm"
  | "decline"
  | "cancel"
  | "markPaid"
  | "complete";

export const ORDER_TRANSITIONS: Record<
  OrderActionName,
  { fromStatus: OrderStatusName[]; toStatus: OrderStatusName }
> = {
  confirm: { fromStatus: ["PENDING"], toStatus: "CONFIRMED" },
  decline: { fromStatus: ["PENDING"], toStatus: "DECLINED" },
  cancel: { fromStatus: ["PENDING", "CONFIRMED"], toStatus: "CANCELLED" },
  // Manual payment (cash, Venmo, etc.) — must not be reapplied once paid.
  markPaid: { fromStatus: ["CONFIRMED"], toStatus: "PAID" },
  complete: { fromStatus: ["PAID", "CONFIRMED"], toStatus: "COMPLETED" },
};

export function isTransitionAllowed(
  action: OrderActionName,
  status: string,
): boolean {
  const transition = ORDER_TRANSITIONS[action];
  if (!transition) return false;
  return (transition.fromStatus as string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Stripe payment attach (checkout.session.completed / payment_intent.succeeded)
// ---------------------------------------------------------------------------

export type PaymentEventAction = "attach-and-advance" | "attach-only" | "skip";

/**
 * Which effect a successful-payment event may have on the order:
 * never resurrect cancelled/declined orders, never reset an advanced status;
 * always safe to attach the payment identifier to a paid-family order.
 */
export function paymentEventAction(status: string): PaymentEventAction {
  if (status === "CONFIRMED") return "attach-and-advance";
  if (status === "PAID" || status === "COMPLETED") return "attach-only";
  return "skip";
}

// ---------------------------------------------------------------------------
// Checkout session idempotency
// ---------------------------------------------------------------------------

export type CheckoutDecision =
  | "reject-paid"
  | "reject-status"
  | "reject-completed-session"
  | "reuse"
  | "create";

/**
 * Decide what a checkout-creation attempt should do given the order state and
 * (when retrievable) the status of the order's previously stored session.
 */
export function nextCheckoutAction(
  order: { status: string; stripePaymentId: string | null },
  sessionStatus?: string | null,
): CheckoutDecision {
  if (order.stripePaymentId || ["PAID", "COMPLETED"].includes(order.status)) {
    return "reject-paid";
  }
  if (order.status !== "CONFIRMED") return "reject-status";
  if (sessionStatus === "open") return "reuse";
  if (sessionStatus === "complete") return "reject-completed-session";
  return "create";
}

// ---------------------------------------------------------------------------
// Persistence-boundary CAS contract (checkout session claim)
// ---------------------------------------------------------------------------

export interface CheckoutClaimSpec {
  where: { id: string; checkoutSessionId: string | null; status: "CONFIRMED" };
  data: { checkoutSessionId: string };
}

/**
 * The compare-and-set a checkout creator must apply to attach a NEW session:
 * it wins only when the order is still seller-confirmed and still holds the
 * session this attempt observed (absent, or the one it just read). A concurrent
 * cancellation, decline, or payment leaves the order outside the claim and the
 * row count comes back zero — the caller then expires the session it minted.
 *
 * Held in one place so routes, the flow module, and the regression tests apply
 * the exact same where/data spec.
 */
export function checkoutClaimSpec(
  orderId: string,
  previousSessionId: string | null,
  newSessionId: string,
): CheckoutClaimSpec {
  return {
    where: { id: orderId, checkoutSessionId: previousSessionId, status: "CONFIRMED" },
    data: { checkoutSessionId: newSessionId },
  };
}

// ---------------------------------------------------------------------------
// Stripe refund reconciliation (charge.amount_refunded based)
// ---------------------------------------------------------------------------

export interface RefundReconciliation {
  status: OrderStatusName;
  refundedCents: number;
  restoreStock: boolean;
}

/**
 * Reconcile an order's cumulative refund balance against Stripe's
 * charge.amount_refunded. Idempotent for replayed or out-of-order events
 * (returns null when nothing would change), and never restores stock twice:
 * only the guarded transition into CANCELLED may restore inventory.
 */
export function applyCumulativeRefund(
  order: { status: string; amountCents: number; refundedCents: number },
  cumulativeRefundedCents: number,
): RefundReconciliation | null {
  if (!Number.isSafeInteger(order.amountCents) || order.amountCents <= 0 ||
      !Number.isSafeInteger(order.refundedCents) || order.refundedCents < 0 ||
      !Number.isSafeInteger(cumulativeRefundedCents) ||
      cumulativeRefundedCents < 0) {
    throw new RangeError("Refund amounts must be non-negative integer cents");
  }
  if (cumulativeRefundedCents > order.amountCents) {
    throw new RangeError("Refunded amount exceeds order total");
  }
  if (cumulativeRefundedCents <= order.refundedCents) return null;

  if (order.status === "CANCELLED") {
    // Terminal from a refund: bump the recorded balance, never touch status/stock.
    return { status: "CANCELLED", refundedCents: cumulativeRefundedCents, restoreStock: false };
  }
  if (order.status === "PAID") {
    const fullyRefunded = cumulativeRefundedCents === order.amountCents;
    return {
      status: fullyRefunded ? "CANCELLED" : "PAID",
      refundedCents: cumulativeRefundedCents,
      restoreStock: fullyRefunded,
    };
  }
  if (order.status === "COMPLETED") {
    const fullyRefunded = cumulativeRefundedCents === order.amountCents;
    return {
      status: fullyRefunded ? "CANCELLED" : "COMPLETED",
      refundedCents: cumulativeRefundedCents,
      restoreStock: false,
    };
  }
  throw new Error(
    `Refund event for order in non-payment status ${order.status}`,
  );
}

// ---------------------------------------------------------------------------
// Admin status overrides
// ---------------------------------------------------------------------------

export type AdminStatusTarget =
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "DECLINED";

/** Terminal states accept no overrides; paid orders may only be completed. */
export const ADMIN_STATUS_RULES: Record<OrderStatusName, AdminStatusTarget[]> = {
  PENDING: ["CONFIRMED", "COMPLETED", "CANCELLED", "DECLINED"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "DECLINED"],
  PAID: ["COMPLETED"],
  CANCELLED: [],
  DECLINED: [],
  COMPLETED: [],
};

export type AdminStatusRejectionCode =
  | "terminal"
  | "payment-transition-forbidden";

export function nextAdminStatus(
  current: string,
  target: string,
  hasStripePayment: boolean,
): { allowed: true } | { allowed: false; code: AdminStatusRejectionCode } {
  const allowed = ADMIN_STATUS_RULES[current as OrderStatusName];
  if (!current || !allowed) {
    return { allowed: false, code: "terminal" };
  }
  if (!(allowed as string[]).includes(target)) {
    const isTerminal = ["CANCELLED", "DECLINED", "COMPLETED"].includes(current);
    if (isTerminal) {
      return { allowed: false, code: "terminal" };
    }
    return { allowed: false, code: "payment-transition-forbidden" };
  }
  if (hasStripePayment && (target === "CANCELLED" || target === "DECLINED")) {
    return { allowed: false, code: "payment-transition-forbidden" };
  }
  return { allowed: true };
}
