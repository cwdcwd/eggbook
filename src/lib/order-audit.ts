import { db } from "@/lib/db";
import { OrderStatus, ChangeActorType, Prisma } from "@prisma/client";

type TransactionClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

interface LogStatusChangeParams {
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedBy?: string | null; // clerkId
  changedByType?: ChangeActorType;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  tx?: TransactionClient; // Optional transaction client
}

/**
 * Log an order status change to the audit trail.
 * Can be used standalone or within a transaction.
 */
export async function logOrderStatusChange({
  orderId,
  fromStatus,
  toStatus,
  changedBy = null,
  changedByType = "SYSTEM",
  reason = null,
  metadata = undefined,
  tx,
}: LogStatusChangeParams) {
  const client = tx || db;
  
  return client.orderStatusHistory.create({
    data: {
      orderId,
      fromStatus,
      toStatus,
      changedBy,
      changedByType,
      reason,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}
