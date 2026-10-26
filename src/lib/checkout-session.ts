/**
 * Checkout session creation flow, extracted from POST /api/checkout so the
 * creation/cancellation interleavings are executable-testable.
 *
 * The flow is the single owner of the session-claim invariant:
 * - a new Stripe session attaches ONLY through checkoutClaimSpec, whose
 *   compare-and-set requires the order to STILL be seller-confirmed with the
 *   session this attempt observed — a cancellation, decline, or payment that
 *   wins the race in between makes the claim a no-op (count 0);
 * - every payable outcome (a session URL handed to the buyer) is re-gated on a
 *   FRESH order read immediately before the response, so a cancelled or paid
 *   order can never receive a still-collectable payment link even when its
 *   stored session lingers open in Stripe (best-effort expiry may have failed).
 *
 * No next/ imports — the route owns auth, schema parsing, and the HTTP
 * envelope; the ports own Stripe and Prisma access.
 */
import {
  checkoutClaimSpec,
  nextCheckoutAction,
  type CheckoutClaimSpec,
} from "./payment-integrity";

export interface CheckoutSessionLike {
  id: string;
  url: string | null;
  status: string | null;
}

export interface CheckoutOrderRow {
  id: string;
  status: string;
  stripePaymentId: string | null;
  checkoutSessionId: string | null;
}

export interface CheckoutSessionCreateInput {
  orderId: string;
  amountCents: number;
  platformFeeCents: number;
  sellerAccount: string | null;
  baseUrl: string;
}

export interface CheckoutSessionPorts {
  /** Fresh read of the order's payment-relevant fields. */
  findOrder(orderId: string): Promise<CheckoutOrderRow | null>;
  /** Retrieve a stored session; null when Stripe says it does not exist. */
  retrieveSession(sessionId: string): Promise<CheckoutSessionLike | null>;
  createSession(input: CheckoutSessionCreateInput): Promise<CheckoutSessionLike>;
  /** Apply the guarded claim spec verbatim (updateMany); returns row count. */
  claimSession(spec: CheckoutClaimSpec): Promise<number>;
  /** Best-effort expiry of a minted session; must never throw. */
  expireSession(sessionId: string): Promise<void>;
}

export type CheckoutFlowResult =
  | { kind: "url"; url: string }
  | { kind: "error"; status: number; error: string };

/**
 * Decide and execute a checkout-creation attempt for one order: idempotent
 * reuse of an open session, guarded creation of a new one, and race-faithful
 * responses when the order's state changed underneath the attempt.
 */
export async function createCheckoutForOrder(
  input: CheckoutSessionCreateInput,
  ports: CheckoutSessionPorts,
): Promise<CheckoutFlowResult> {
  const order = await ports.findOrder(input.orderId);
  if (!order) {
    return { kind: "error", status: 404, error: "Order not found" };
  }

  const storedSession = order.checkoutSessionId
    ? await ports.retrieveSession(order.checkoutSessionId)
    : null;
  const sessionStatus = storedSession ? storedSession.status : null;

  const decision = nextCheckoutAction(
    { status: order.status, stripePaymentId: order.stripePaymentId },
    sessionStatus
  );

  if (decision === "reject-paid") {
    return { kind: "error", status: 409, error: "Order has already been paid" };
  }
  if (decision === "reject-status") {
    return {
      kind: "error",
      status: 400,
      error: "Order must be confirmed by seller before payment",
    };
  }
  if (decision === "reject-completed-session") {
    return {
      kind: "error",
      status: 409,
      error: "A previous checkout session already completed; awaiting payment confirmation",
    };
  }

  if (decision === "reuse") {
    // Returning an open session URL is a positive payable outcome: re-gate on a
    // FRESH read so a cancellation/payment that won the race since the original
    // read is honored even if Stripe could not expire the old session.
    const fresh = await ports.findOrder(input.orderId);
    if (!fresh) {
      return { kind: "error", status: 404, error: "Order not found" };
    }
    const recheck = nextCheckoutAction(
      { status: fresh.status, stripePaymentId: fresh.stripePaymentId },
      "open"
    );
    if (recheck === "reject-paid") {
      return { kind: "error", status: 409, error: "Order has already been paid" };
    }
    if (recheck === "reject-status") {
      return {
        kind: "error",
        status: 400,
        error: "Order must be confirmed by seller before payment",
      };
    }
    if (!storedSession?.url) {
      return {
        kind: "error",
        status: 409,
        error: "Checkout session could not be settled; please retry",
      };
    }
    return { kind: "url", url: storedSession.url };
  }

  // decision === "create"
  const session = await ports.createSession(input);

  // Atomically claim the session slot AND the order's payable state.
  const claimCount = await ports.claimSession(
    checkoutClaimSpec(order.id, order.checkoutSessionId, session.id)
  );
  if (claimCount === 1) {
    return { kind: "url", url: session.url! };
  }

  // The claim was lost: either another creator won the slot, or the order left
  // the payable state (cancellation/decline/payment) between the read and the
  // claim. The session minted here must not remain payable either way.
  await ports.expireSession(session.id);

  const fresh = await ports.findOrder(input.orderId);
  if (fresh) {
    const recheck = nextCheckoutAction({
      status: fresh.status,
      stripePaymentId: fresh.stripePaymentId,
    });
    if (recheck === "reject-paid") {
      return { kind: "error", status: 409, error: "Order has already been paid" };
    }
    if (recheck === "reject-status") {
      return {
        kind: "error",
        status: 400,
        error: "Order must be confirmed by seller before payment",
      };
    }
    // Still payable — another creator won the session slot; hand back theirs.
    if (fresh.checkoutSessionId && fresh.checkoutSessionId !== session.id) {
      const winner = await ports.retrieveSession(fresh.checkoutSessionId);
      if (winner?.status === "open" && winner.url) {
        return { kind: "url", url: winner.url };
      }
    }
  }
  return {
    kind: "error",
    status: 409,
    error: "Checkout session could not be settled; please retry",
  };
}