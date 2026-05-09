/**
 * Cleanup Script for Eggbook Synthetic Data
 *
 * Removes all test data created by the seed script.
 * Identifies test data by:
 * - Users with clerkId starting with "test_"
 * - All related data cascades from user deletion
 *
 * Usage: npx tsx scripts/cleanup.ts
 *
 * Options:
 *   --dry-run  Show what would be deleted without actually deleting
 *   --force    Skip confirmation prompt
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import * as readline from 'readline'

// Test data markers (must match seed.ts)
const TEST_PREFIX = '[TEST]'
const TEST_CLERK_PREFIX = 'test_'

// Database setup
function getDatabaseUrl(): string {
  const url = process.env.PRISMA_DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!url) {
    throw new Error('No database URL found. Set PRISMA_DATABASE_URL, POSTGRES_URL, or DATABASE_URL')
  }
  return url
}

const pool = new Pool({ connectionString: getDatabaseUrl() })
const adapter = new PrismaPg(pool)
const db = new PrismaClient({ adapter })

// Parse command line arguments
const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const isForce = args.includes('--force')

async function promptConfirmation(message: string): Promise<boolean> {
  if (isForce) return true

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function countTestData() {
  const counts = {
    users: await db.user.count({
      where: { clerkId: { startsWith: TEST_CLERK_PREFIX } },
    }),
    sellerProfiles: await db.sellerProfile.count({
      where: { displayName: { contains: TEST_PREFIX } },
    }),
    listings: await db.eggListing.count({
      where: { title: { contains: TEST_PREFIX } },
    }),
    orders: 0,
    orderHistory: 0,
    conversations: 0,
    messages: 0,
    favorites: 0,
    posts: await db.post.count({
      where: { content: { contains: TEST_PREFIX } },
    }),
    monthlyVolumes: 0,
  }

  // Get test user IDs for related counts
  const testUsers = await db.user.findMany({
    where: { clerkId: { startsWith: TEST_CLERK_PREFIX } },
    select: { id: true },
  })
  const testUserIds = testUsers.map((u) => u.id)

  if (testUserIds.length > 0) {
    counts.orders = await db.order.count({
      where: { buyerId: { in: testUserIds } },
    })

    counts.conversations = await db.conversation.count({
      where: {
        OR: [
          { buyerId: { in: testUserIds } },
          { sellerId: { in: testUserIds } },
        ],
      },
    })

    counts.messages = await db.message.count({
      where: { senderId: { in: testUserIds } },
    })

    counts.favorites = await db.favorite.count({
      where: { userId: { in: testUserIds } },
    })
  }

  // Get test seller profile IDs for volume counts
  const testProfiles = await db.sellerProfile.findMany({
    where: { displayName: { contains: TEST_PREFIX } },
    select: { id: true },
  })
  const testProfileIds = testProfiles.map((p) => p.id)

  if (testProfileIds.length > 0) {
    counts.monthlyVolumes = await db.sellerMonthlyVolume.count({
      where: { sellerId: { in: testProfileIds } },
    })

    counts.orderHistory = await db.orderStatusHistory.count({
      where: {
        order: {
          sellerId: { in: testProfileIds },
        },
      },
    })
  }

  return counts
}

async function cleanupTestData() {
  console.log('🧹 Eggbook Test Data Cleanup\n')

  if (isDryRun) {
    console.log('📋 DRY RUN MODE - No data will be deleted\n')
  }

  // Count existing test data
  console.log('Scanning for test data...\n')
  const counts = await countTestData()

  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0)

  if (totalRecords === 0) {
    console.log('✅ No test data found. Database is clean.')
    return
  }

  console.log('Found test data:')
  console.log(`  👤 Users:          ${counts.users}`)
  console.log(`  🏪 Seller Profiles: ${counts.sellerProfiles}`)
  console.log(`  🥚 Listings:       ${counts.listings}`)
  console.log(`  📦 Orders:         ${counts.orders}`)
  console.log(`  📜 Order History:  ${counts.orderHistory}`)
  console.log(`  💬 Conversations:  ${counts.conversations}`)
  console.log(`  ✉️  Messages:       ${counts.messages}`)
  console.log(`  ❤️  Favorites:      ${counts.favorites}`)
  console.log(`  📝 Posts:          ${counts.posts}`)
  console.log(`  📊 Monthly Volumes: ${counts.monthlyVolumes}`)
  console.log(`  ──────────────────`)
  console.log(`  Total:             ${totalRecords} records\n`)

  if (isDryRun) {
    console.log('📋 Dry run complete. Run without --dry-run to delete.')
    return
  }

  // Confirm deletion
  const confirmed = await promptConfirmation('⚠️  Delete all test data?')
  if (!confirmed) {
    console.log('\n❌ Cleanup cancelled.')
    return
  }

  console.log('\nDeleting test data...\n')

  // Delete in correct order to respect foreign key constraints
  // Note: Most cascades are handled by Prisma schema, but we delete explicitly for accuracy

  // 1. Get test user IDs and profile IDs
  const testUsers = await db.user.findMany({
    where: { clerkId: { startsWith: TEST_CLERK_PREFIX } },
    select: { id: true },
  })
  const testUserIds = testUsers.map((u) => u.id)

  const testProfiles = await db.sellerProfile.findMany({
    where: { displayName: { contains: TEST_PREFIX } },
    select: { id: true },
  })
  const testProfileIds = testProfiles.map((p) => p.id)

  // 2. Delete order status history (no cascade, linked to orders)
  if (testProfileIds.length > 0) {
    const deletedHistory = await db.orderStatusHistory.deleteMany({
      where: {
        order: {
          sellerId: { in: testProfileIds },
        },
      },
    })
    console.log(`  ✓ Deleted ${deletedHistory.count} order history records`)
  }

  // 3. Delete messages (cascaded by conversation, but explicit for counts)
  if (testUserIds.length > 0) {
    const deletedMessages = await db.message.deleteMany({
      where: { senderId: { in: testUserIds } },
    })
    console.log(`  ✓ Deleted ${deletedMessages.count} messages`)
  }

  // 4. Delete conversations
  if (testUserIds.length > 0) {
    const deletedConvos = await db.conversation.deleteMany({
      where: {
        OR: [
          { buyerId: { in: testUserIds } },
          { sellerId: { in: testUserIds } },
        ],
      },
    })
    console.log(`  ✓ Deleted ${deletedConvos.count} conversations`)
  }

  // 5. Delete favorites
  if (testUserIds.length > 0) {
    const deletedFavorites = await db.favorite.deleteMany({
      where: { userId: { in: testUserIds } },
    })
    console.log(`  ✓ Deleted ${deletedFavorites.count} favorites`)
  }

  // 6. Delete orders
  if (testUserIds.length > 0) {
    const deletedOrders = await db.order.deleteMany({
      where: { buyerId: { in: testUserIds } },
    })
    console.log(`  ✓ Deleted ${deletedOrders.count} orders`)
  }

  // 7. Delete posts
  if (testProfileIds.length > 0) {
    const deletedPosts = await db.post.deleteMany({
      where: { sellerId: { in: testProfileIds } },
    })
    console.log(`  ✓ Deleted ${deletedPosts.count} posts`)
  }

  // 8. Delete monthly volumes
  if (testProfileIds.length > 0) {
    const deletedVolumes = await db.sellerMonthlyVolume.deleteMany({
      where: { sellerId: { in: testProfileIds } },
    })
    console.log(`  ✓ Deleted ${deletedVolumes.count} monthly volumes`)
  }

  // 9. Delete listings (disconnect tags first if needed)
  const deletedListings = await db.eggListing.deleteMany({
    where: { title: { contains: TEST_PREFIX } },
  })
  console.log(`  ✓ Deleted ${deletedListings.count} listings`)

  // 10. Delete seller profiles
  const deletedProfiles = await db.sellerProfile.deleteMany({
    where: { displayName: { contains: TEST_PREFIX } },
  })
  console.log(`  ✓ Deleted ${deletedProfiles.count} seller profiles`)

  // 11. Delete test users
  const deletedUsers = await db.user.deleteMany({
    where: { clerkId: { startsWith: TEST_CLERK_PREFIX } },
  })
  console.log(`  ✓ Deleted ${deletedUsers.count} users`)

  // Note: We don't delete tags since they may be used by real data
  // and were created/reused by the seed script

  console.log('\n✅ Cleanup completed successfully!')
}

async function main() {
  try {
    await cleanupTestData()
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error)
    process.exit(1)
  } finally {
    await db.$disconnect()
    await pool.end()
  }
}

main()
