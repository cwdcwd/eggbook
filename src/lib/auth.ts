import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from './db'

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

    user = await db.user.create({
      data: {
        clerkId: clerkUserId,
        email,
        username: clerkUser.username || email.split("@")[0],
        role: "BUYER",
      },
      include: { sellerProfile: true },
    });
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

export async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'ADMIN') {
    throw new Error('Admin access required')
  }
  return user
}

export async function syncUserFromClerk(clerkUser: {
  id: string
  username: string | null
  emailAddresses: { emailAddress: string }[]
}) {
  const email = clerkUser.emailAddresses[0]?.emailAddress
  if (!email) throw new Error('No email found')

  const username = clerkUser.username || email.split('@')[0]

  return db.user.upsert({
    where: { clerkId: clerkUser.id },
    update: { email, username },
    create: {
      clerkId: clerkUser.id,
      email,
      username,
      role: 'BUYER',
    },
  })
}
