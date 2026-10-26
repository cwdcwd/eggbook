/**
 * Guarded order transition flow, extracted from the seller-action and
 * admin-override route handlers so the cancellation/claim interleavings are
 * executable-testable.
 *
 * The flow is the single owner of the post-transition expiry invariant:
 * - a transition applies only as a compare-and-set guarded on the status the
 *   read observed. A concurrent checkout-session claim touches
 *   checkoutSessionId but NOT status, so it cannot invalidate the CAS — the
 *   transition still lands;
 * - the session snapshot that decides "which checkout session must no longer
 *   be payable" is taken from a FRESH read AFTER the CAS, never from the
 *   pre-transition read. A claim committing between the read and the CAS is
 *   invisible to the pre-CAS snapshot but captured by the post-CAS read (the
 *   claim itself is gated on the order still being CONFIRMED, so nothing can
 *   claim after the transition lands). Expiring the stale id instead would
 *   leave a cancelled order with an open, collectable session — the buyer's
 *   payment succeeds against a cancelled, stock-restored order with no
 *   recovery path.
 *
 * No next/ imports — the routes own auth, schema parsing, the HTTP envelope,
 * and WHEN the recorded expiry actually runs (deferred past the response via
 * `after`); the ports own Prisma and Stripe access.
 */

/** Where/data of the guarded updateMany; applied verbatim by the port. */
export interface GuardedTransitionSpec<TCurrent extends { status: string }> {
  where: { id: string; status: TCurrent["status"] };
  data: Record<string, unknown>;
}

export interface GuardedTransitionPlan {
  /** The status this transition moves the order into. */
  toStatus: string;
  data: Record<string, unknown>;
}

/** Every post-transition row must carry the session slot for the expiry decision. */
export interface PostTransitionRow {
  checkoutSessionId: string | null;
}

export interface GuardedTransitionPorts<TCurrent extends { status: string }, TRow extends PostTransitionRow> {
  /** Fresh read of the order inside the transaction; throws when missing. */
  findCurrent(orderId: string): Promise<TCurrent>;
  /**
   * Apply the guarded compare-and-set verbatim (updateMany); returns the row
   * count — 0 means a concurrent mutation won and the transition is a no-op.
   */
  applyTransition(spec: GuardedTransitionSpec<TCurrent>): Promise<number>;
  /**
   * Full re-read AFTER the CAS landed — the only trustworthy snapshot of the
   * order's current session slot.
   */
  readAfterTransition(orderId: string): Promise<TRow>;
  /**
   * Expiry hook for the post-CAS session snapshot; called EXACTLY when the
   * transition landed and the target status makes the session unpayable.
   * Production records the id inside the transaction and defers the real
   * Stripe call past the response, so a rollback cannot leave an expiry
   * scheduled for an order that was never cancelled; tests record inline.
   */
  expireSession(sessionId: string): Promise<void>;
}

export interface GuardedTransitionApplied<TRow> {
  applied: true;
  /** The post-CAS re-read; the response payload. */
  row: TRow;
  /** The session id the expiry hook consumed (null unless cancel/decline won). */
  expiredSessionId: string | null;
}

export type GuardedTransitionResult<TRow> =
  | { applied: false }
  | GuardedTransitionApplied<TRow>;

/** Target statuses that make a stored checkout session unpayable. */
const EXPIRY_ELIGIBLE_STATUSES: readonly string[] = ["CANCELLED", "DECLINED"];

/**
 * Decide and execute one order transition under shared invariants: the CAS
 * gates on the observed status, and the eligible-cancellation expiry consumes
 * the session id read AFTER the CAS — the snapshot that has seen every claim
 * that could have committed in the race window.
 */
export async function runGuardedOrderTransition<
  TCurrent extends { status: string },
  TRow extends PostTransitionRow,
>(args: {
  orderId: string;
  ports: GuardedTransitionPorts<TCurrent, TRow>;
  /**
   * Route policy: validate the observed state and build the write. Returning
   * null maps to the shared conflict outcome — the CAS never runs.
   */
  plan: (current: TCurrent) => GuardedTransitionPlan | null;
  /** Route-policy side effects after the CAS landed, before the response. */
  onApplied?: (context: {
    current: TCurrent;
    plan: GuardedTransitionPlan;
    row: TRow;
  }) => Promise<void>;
}): Promise<GuardedTransitionResult<TRow>> {
  const current = await args.ports.findCurrent(args.orderId);
  const plan = args.plan(current);
  if (!plan) {
    return { applied: false };
  }

  // Compare-and-set: applies only if the status is unchanged since the read;
  // a concurrent transition makes this a no-op we surface as a conflict.
  // A session claim does not touch status, so it does not block this — which
  // is exactly why the expiry snapshot must be taken AFTER this lands.
  const updatedRows = await args.ports.applyTransition({
    where: { id: args.orderId, status: current.status },
    data: plan.data,
  });
  if (updatedRows === 0) {
    return { applied: false };
  }

  // Post-CAS snapshot: a claim committing between the read above and the CAS
  // is invisible to `current` but captured here, and since the claim is gated
  // on status CONFIRMED it cannot land after the transition — this read is
  // stable and authoritative for the session-slot state.
  const row = await args.ports.readAfterTransition(args.orderId);

  await args.onApplied?.({ current, plan, row });

  // Eligible cancellation/decline: the order's CURRENT session must no longer
  // be payable. The id comes from the post-CAS row — never from the stale
  // pre-CAS snapshot (the charged-but-cancelled hole this flow closes).
  let expiredSessionId: string | null = null;
  if (EXPIRY_ELIGIBLE_STATUSES.includes(plan.toStatus) && row.checkoutSessionId) {
    expiredSessionId = row.checkoutSessionId;
    await args.ports.expireSession(expiredSessionId);
  }

  return { applied: true, row, expiredSessionId };
}