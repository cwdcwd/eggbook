/**
 * Guarded persistence application of a refund reconciliation — shared by the
 * Stripe webhook and the admin refund endpoint so that the compare-and-set on
 * the reconciled state and the restore-stock-once rule live in exactly one
 * place.
 *
 * The ports apply the specs VERBATIM inside the caller's transaction; the
 * regression suite drives the same specs against an in-memory store that
 * enforces conditional-update semantics, so the where-clause contract and the
 * stock invariant are exercised, not assumed.
 *
 * No next/ imports — callers own Stripe, auth, and the HTTP envelope.
 */
import type { OrderStatusName, RefundReconciliation } from "./payment-integrity";

export interface RefundOrderSnapshot {
  id: string;
  /** The order status the reconciliation was computed against. */
  status: OrderStatusName;
  /** The cumulative refunded cents the reconciliation was computed against. */
  refundedCents: number;
  listingId: string | null;
  quantity: number;
}

export interface RefundOrderGuardedSpec {
  where: { id: string; status: OrderStatusName; refundedCents: number };
  data: {
    status: OrderStatusName;
    refundedCents: number;
    cancelledAt?: Date;
    cancelReason?: string;
  };
}

export interface RefundReconcileAudit {
  fromStatus: OrderStatusName;
  toStatus: OrderStatusName;
  refundedCents: number;
}

export interface RefundApplyPort {
  /** Apply the guarded spec verbatim (updateMany); returns the row count. */
  updateOrderGuarded(spec: RefundOrderGuardedSpec): Promise<number>;
  /** Give the purchased quantity back to the listing. */
  restoreStock(listingId: string, quantity: number): Promise<void>;
  /** Write the audit entry inside the same transaction. */
  logAudit(entry: RefundReconcileAudit): Promise<void>;
}

export interface RefundReconcileResult {
  /** false = the order changed concurrently; the caller must surface it. */
  applied: boolean;
  orderStatus: string;
  refundedCents: number;
}

/**
 * Apply a computed refund transition to the order, guarded so it can only
 * succeed from the state the transition was reconciled against:
 * - compare-and-set on (id, status, refundedCents) — a concurrent webhook or
 *   dashboard refund makes the update a no-op (applied: false, zero rows),
 * - stock is restored exactly once: only the guarded first transition into
 *   CANCELLED carries restoreStock (never partial refunds, never COMPLETED
 *   orders, never a repeated event — applyCumulativeRefund guarantees that).
 */
export async function applyRefundReconciliation(
  snapshot: RefundOrderSnapshot,
  transition: RefundReconciliation,
  tx: RefundApplyPort,
  options?: { cancelReason?: string },
): Promise<RefundReconcileResult> {
  const spec: RefundOrderGuardedSpec = {
    where: {
      id: snapshot.id,
      status: snapshot.status,
      refundedCents: snapshot.refundedCents,
    },
    data: {
      status: transition.status,
      refundedCents: transition.refundedCents,
      ...(transition.status === "CANCELLED"
        ? {
            cancelledAt: new Date(),
            cancelReason: options?.cancelReason ?? "Refunded",
          }
        : {}),
    },
  };

  const updatedRows = await tx.updateOrderGuarded(spec);
  if (updatedRows === 0) {
    return {
      applied: false,
      orderStatus: snapshot.status,
      refundedCents: snapshot.refundedCents,
    };
  }

  if (transition.restoreStock) {
    if (!snapshot.listingId) {
      throw new Error(
        `Refunded order ${snapshot.id} has no listing to restore stock for`
      );
    }
    await tx.restoreStock(snapshot.listingId, snapshot.quantity);
  }

  await tx.logAudit({
    fromStatus: snapshot.status,
    toStatus: transition.status,
    refundedCents: transition.refundedCents,
  });

  return {
    applied: true,
    orderStatus: transition.status,
    refundedCents: transition.refundedCents,
  };
}