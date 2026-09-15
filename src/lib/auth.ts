import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from './db'
import { upsertClerkUser } from './user-sync'

/**
 * Verify admin access using Clerk session claims.
 * Requires an explicit "admin" role claim — no DB fallback.
 * Consistent with middleware which also blocks without the claim.
 */
export async function verifyAdmin(): Promise<boolean> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return false;

  const metadata = sessionClaims?.metadata as { role?: string } | undefined;
  const clerkRole = metadata?.role;

  return !!clerkRole && clerkRole.toUpperCase() === "ADMIN";
}

/**
 * Get user from database, or create from Clerk data if not exists.
 * Handles the case where Clerk webhook hasn't synced the user yet.
 */
export async function getOrCreateUser(clerkUserId: string) {
  let user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    include: { sellerProfile: true },
  });

  if (!user) {
    // User not in DB yet - fetch from Clerk and create
    const clerkUser = await currentUser();
    if (!clerkUser) {
      return null;
    }

    const email = clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) {
      return null;
    }

    // Shared idempotent sync — same code path as the Clerk webhook, so
    // the fallback and the webhook cannot diverge or P2002-race each other.
    await upsertClerkUser({
      clerkId: clerkUserId,
      email,
      username: clerkUser.username ?? null,
    });

    // Re-read with the sellerProfile include the callers rely on; this is
    // also the canonical row if a concurrent path created it first.
    user = await db.user.findUnique({
      where: { clerkId: clerkUserId },
      include: { sellerProfile: true },
    });
    if (!user) {
      return null;
    }
  }

  return user;
}

export async function getCurrentUser() {
  const user = await currentUser()
  if (!user) return null

  const dbUser = await db.user.findUnique({
    where: { clerkId: user.id },
    include: { sellerProfile: true },
  })

  return dbUser
}

export async function requireAuth() {
  const { userId } = await auth()
  if (!userId) {
    throw new Error('Unauthorized')
  }
  return userId
}

export async function requireSeller() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'SELLER') {
    throw new Error('Seller access required')
  }
  return user
}
