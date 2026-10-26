import { Prisma, SubscriptionStatus, UserRole } from "@prisma/client";
import { db } from "@/lib/db";

export interface ClerkUserRow {
  id: string;
  clerkId: string;
  email: string;
  username: string;
  role?: UserRole | string;
  deletedAt: Date | null;
  [key: string]: unknown;
}

export interface ClerkProfile {
  id: string;
  username: string | null;
  emailAddresses: { emailAddress: string }[];
}

type LifecycleTransaction = {
  findUser(clerkId: string): Promise<ClerkUserRow | null>;
  findIdentityConflicts(clerkId: string, email: string, username: string): Promise<{ email: boolean; username: boolean }>;
  saveUser(input: { clerkId: string; email: string; username: string; existing: ClerkUserRow | null }): Promise<ClerkUserRow>;
  isDeleted(clerkId: string): Promise<boolean>;
  createTombstone(clerkId: string): Promise<void>;
  anonymizeUser(user: ClerkUserRow): Promise<void>;
  removeFavorites(userId: string): Promise<void>;
  redactMessages(userId: string): Promise<void>;
  deactivateSeller(userId: string): Promise<void>;
  hideListings(userId: string): Promise<void>;
};

export interface ClerkUserLifecyclePort {
  transaction<T>(clerkId: string, action: (tx: LifecycleTransaction) => Promise<T>): Promise<T>;
  findUser(clerkId: string): Promise<ClerkUserRow | null>;
  findIdentityConflicts(clerkId: string, email: string, username: string): Promise<{ email: boolean; username: boolean }>;
}

function isUniqueConstraint(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2002";
}

function availableUsername(base: string, userId: string, conflict: boolean): string {
  return conflict ? `${base.slice(0, 48)}-${userId.slice(-8)}` : base;
}

export async function syncClerkUser(
  clerkUser: ClerkProfile,
  port: ClerkUserLifecyclePort = prismaLifecyclePort
): Promise<ClerkUserRow | null> {
  const email = clerkUser.emailAddresses[0]?.emailAddress?.trim().toLowerCase();
  if (!email) return null;
  const baseUsername = clerkUser.username?.trim() || email.split("@")[0];

  try {
    return await port.transaction(clerkUser.id, async (tx) => {
      if (await tx.isDeleted(clerkUser.id)) return null;
      const existing = await tx.findUser(clerkUser.id);
      const conflicts = await tx.findIdentityConflicts(clerkUser.id, email, baseUsername);
      if (conflicts.email) {
        console.warn(`[Clerk] Ignoring email sync for ${clerkUser.id}: email belongs to another account`);
        return existing;
      }
      const username = availableUsername(baseUsername, clerkUser.id, conflicts.username);
      return await tx.saveUser({ clerkId: clerkUser.id, email, username, existing });
    });
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    // A concurrent delivery may win a unique insert. Re-read only after the
    // failed transaction has rolled back; PostgreSQL rejects further queries
    // inside a transaction after a constraint violation.
    const winner = await port.findUser(clerkUser.id);
    if (winner) return winner;
    const racedConflict = await port.findIdentityConflicts(clerkUser.id, email, baseUsername);
    if (racedConflict.email || racedConflict.username) {
      console.warn(`[Clerk] Ignoring identity conflict while syncing ${clerkUser.id}`);
      return null;
    }
    throw error;
  }
}

export async function deleteClerkUser(
  clerkId: string,
  port: ClerkUserLifecyclePort = prismaLifecyclePort
): Promise<boolean> {
  if (!clerkId) return false;
  return port.transaction(clerkId, async (tx) => {
    if (await tx.isDeleted(clerkId)) return false;
    const user = await tx.findUser(clerkId);
    await tx.createTombstone(clerkId);
    if (!user) return false;

    // Retain orders and conversation records to preserve transaction and
    // safety history; scrub direct identifiers and user-authored messages.
    // Remove favorites, anonymize account/profile data, and hide inventory in
    // the same transaction as the permanent Clerk-id tombstone.
    await tx.removeFavorites(user.id);
    await tx.redactMessages(user.id);
    await tx.deactivateSeller(user.id);
    await tx.hideListings(user.id);
    await tx.anonymizeUser(user);
    return true;
  });
}

function transactionPort(tx: Prisma.TransactionClient): LifecycleTransaction {
  return {
    findUser: async (clerkId) => await tx.user.findUnique({ where: { clerkId } }) as ClerkUserRow | null,
    findIdentityConflicts: async (clerkId, email, username) => {
      const matches = await tx.user.findMany({ where: { clerkId: { not: clerkId }, OR: [{ email }, { username }] }, select: { email: true, username: true } });
      return { email: matches.some((row) => row.email === email), username: matches.some((row) => row.username === username) };
    },
    saveUser: async ({ clerkId, email, username }) => await tx.user.upsert({
      where: { clerkId }, update: { email, username }, create: { clerkId, email, username, role: UserRole.BUYER },
    }) as ClerkUserRow,
    isDeleted: async (clerkId) => !!(await tx.clerkUserTombstone.findUnique({ where: { clerkId }, select: { clerkId: true } })),
    createTombstone: async (clerkId) => { await tx.clerkUserTombstone.create({ data: { clerkId } }); },
    anonymizeUser: async (user) => {
      await tx.user.update({ where: { id: user.id }, data: {
        clerkId: `deleted:${user.id}`, email: `deleted+${user.id}@invalid.example`,
        username: `deleted-${user.id}`, deletedAt: new Date(), subscriptionId: null,
        subscriptionPlan: null, subscriptionStatus: SubscriptionStatus.NONE,
        subscriptionExpiresAt: null, listingLimit: null,
      } });
      await tx.order.updateMany({ where: { buyerId: user.id }, data: { deliveryAddress: null, deliveryLat: null, deliveryLng: null } });
    },
    removeFavorites: async (userId) => { await tx.favorite.deleteMany({ where: { userId } }); },
    redactMessages: async (userId) => { await tx.message.updateMany({ where: { senderId: userId }, data: { content: "[Message removed]" } }); },
    deactivateSeller: async (userId) => {
      await tx.sellerProfile.updateMany({ where: { userId }, data: {
        displayName: "Deleted seller", bio: null, avatarUrl: null, address: null, city: null,
        state: null, zip: null, lat: null, lng: null, maxDeliveryDistance: null,
        pickupHours: Prisma.JsonNull, isActive: false, stripeAccountId: null, stripeOnboarded: false,
      } });
    },
    hideListings: async (userId) => { await tx.eggListing.updateMany({ where: { seller: { userId } }, data: { isAvailable: false } }); },
  };
}

const prismaLifecyclePort: ClerkUserLifecyclePort = {
  async transaction<T>(clerkId: string, action: (tx: LifecycleTransaction) => Promise<T>): Promise<T> {
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`clerk-user:${clerkId}`}), 0)`;
      return action(transactionPort(tx));
    });
  },
  async findUser(clerkId) { return await db.user.findUnique({ where: { clerkId } }) as ClerkUserRow | null; },
  async findIdentityConflicts(clerkId, email, username) {
    const matches = await db.user.findMany({ where: { clerkId: { not: clerkId }, OR: [{ email }, { username }] }, select: { email: true, username: true } });
    return { email: matches.some((row) => row.email === email), username: matches.some((row) => row.username === username) };
  },
};
