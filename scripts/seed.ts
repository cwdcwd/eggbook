/**
 * Synthetic Data Seed Script for Eggbook
 *
 * Creates test data for all features:
 * - Users (buyers, sellers, admin)
 * - Seller profiles with varied settings
 * - Egg listings with different pricing units and tags
 * - Orders in various states
 * - Conversations and messages
 * - Favorites
 * - Order status history
 * - Seller monthly volumes
 *
 * All synthetic data is marked with a "[TEST]" prefix in usernames/titles
 * or uses clerkId starting with "test_" for easy identification and cleanup.
 *
 * Usage: npx tsx scripts/seed.ts
 */

import { PrismaClient, OrderStatus, FulfillmentType, PricingUnit, PickupType, PaymentMethod, UserRole, SubscriptionStatus, FeeTier, ChangeActorType } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Test data marker - all synthetic data uses this prefix
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

// Helper functions
function randomFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number, decimals = 2): number {
  return Number((Math.random() * (max - min) + min).toFixed(decimals))
}

function generateCoordinates(baseLatLng: { lat: number; lng: number }, radiusMiles: number) {
  // Approximate degrees per mile
  const latPerMile = 1 / 69
  const lngPerMile = 1 / (69 * Math.cos(baseLatLng.lat * Math.PI / 180))

  const latOffset = (Math.random() - 0.5) * 2 * radiusMiles * latPerMile
  const lngOffset = (Math.random() - 0.5) * 2 * radiusMiles * lngPerMile

  return {
    lat: baseLatLng.lat + latOffset,
    lng: baseLatLng.lng + lngOffset,
  }
}

// Sample data
const cities = [
  { city: 'Portland', state: 'OR', lat: 45.5152, lng: -122.6784 },
  { city: 'Seattle', state: 'WA', lat: 47.6062, lng: -122.3321 },
  { city: 'San Francisco', state: 'CA', lat: 37.7749, lng: -122.4194 },
  { city: 'Austin', state: 'TX', lat: 30.2672, lng: -97.7431 },
  { city: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903 },
  { city: 'Nashville', state: 'TN', lat: 36.1627, lng: -86.7816 },
]

const eggTypes = [
  { name: 'Chicken', slug: 'chicken' },
  { name: 'Duck', slug: 'duck' },
  { name: 'Quail', slug: 'quail' },
  { name: 'Goose', slug: 'goose' },
  { name: 'Turkey', slug: 'turkey' },
]

const eggQualities = [
  { name: 'Free Range', slug: 'free-range' },
  { name: 'Organic', slug: 'organic' },
  { name: 'Pasture Raised', slug: 'pasture-raised' },
  { name: 'Cage Free', slug: 'cage-free' },
  { name: 'Non-GMO', slug: 'non-gmo' },
]

const eggColors = [
  { name: 'Brown', slug: 'brown' },
  { name: 'White', slug: 'white' },
  { name: 'Blue', slug: 'blue' },
  { name: 'Green', slug: 'green' },
  { name: 'Speckled', slug: 'speckled' },
]

const sellerNames = [
  'Happy Hen Farm',
  'Sunrise Eggs',
  'Backyard Betty',
  'Green Pasture Poultry',
  'The Egg Stand',
  'Clover Hill Farm',
  'Golden Yolk Ranch',
  'Country Fresh Eggs',
  'Morning Glory Farm',
  'The Coop Collective',
]

const buyerNames = [
  'Jane Buyer',
  'Mike Customer',
  'Sarah Shopper',
  'Tom EggLover',
  'Emily Foodie',
]

const messageTemplates = {
  buyer: [
    'Hi! I\'m interested in your eggs. Are they available for pickup today?',
    'What time works best for pickup this week?',
    'Do you have any duck eggs available?',
    'I loved the last batch! Can I order more?',
    'Are your chickens raised on pasture?',
  ],
  seller: [
    'Thanks for your interest! Yes, eggs are available.',
    'I\'m available for pickup between 9am-5pm on weekdays.',
    'I just collected fresh eggs this morning!',
    'Thank you for your order! Looking forward to seeing you.',
    'Yes, all our birds are pasture-raised and happy!',
  ],
}

const listingDescriptions = [
  'Farm fresh eggs from our happy hens! Collected daily and never more than 2 days old.',
  'Our girls roam freely on 5 acres of pasture, eating bugs and grass all day.',
  'Premium quality eggs with bright orange yolks. Perfect for baking or frying!',
  'Raised without antibiotics or hormones. Fed non-GMO organic feed.',
  'Beautiful assorted colors from our heritage breed flock.',
]

async function seedTags() {
  console.log('📌 Creating tags...')
  const allTags = [...eggTypes, ...eggQualities, ...eggColors]

  const tags = []
  for (const tag of allTags) {
    const existingTag = await db.tag.findUnique({ where: { slug: tag.slug } })
    if (existingTag) {
      tags.push(existingTag)
    } else {
      const newTag = await db.tag.create({
        data: { name: tag.name, slug: tag.slug },
      })
      tags.push(newTag)
    }
  }

  console.log(`  ✓ ${tags.length} tags created/found`)
  return tags
}

async function seedUsers() {
  console.log('👤 Creating users...')

  const users = []

  // Create admin user
  const admin = await db.user.create({
    data: {
      clerkId: `${TEST_CLERK_PREFIX}admin_001`,
      username: `${TEST_PREFIX}admin`,
      email: `test_admin@eggbook.test`,
      role: UserRole.ADMIN,
    },
  })
  users.push(admin)
  console.log(`  ✓ Admin: ${admin.username}`)

  // Create seller users
  for (let i = 0; i < sellerNames.length; i++) {
    const seller = await db.user.create({
      data: {
        clerkId: `${TEST_CLERK_PREFIX}seller_${String(i + 1).padStart(3, '0')}`,
        username: `${TEST_PREFIX}seller${i + 1}`,
        email: `test_seller${i + 1}@eggbook.test`,
        role: UserRole.SELLER,
        subscriptionStatus: i < 7 ? SubscriptionStatus.ACTIVE : randomFromArray([SubscriptionStatus.NONE, SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELED]),
        subscriptionPlan: i < 7 ? 'seller_plan' : null,
        subscriptionId: i < 7 ? `sub_test_${i + 1}` : null,
        listingLimit: i < 5 ? null : randomBetween(3, 10),
      },
    })
    users.push(seller)
    console.log(`  ✓ Seller: ${seller.username}`)
  }

  // Create buyer users
  for (let i = 0; i < buyerNames.length; i++) {
    const buyer = await db.user.create({
      data: {
        clerkId: `${TEST_CLERK_PREFIX}buyer_${String(i + 1).padStart(3, '0')}`,
        username: `${TEST_PREFIX}buyer${i + 1}`,
        email: `test_buyer${i + 1}@eggbook.test`,
        role: UserRole.BUYER,
      },
    })
    users.push(buyer)
    console.log(`  ✓ Buyer: ${buyer.username}`)
  }

  return users
}

async function seedSellerProfiles(users: Awaited<ReturnType<typeof seedUsers>>) {
  console.log('🏪 Creating seller profiles...')

  const sellers = users.filter(u => u.role === UserRole.SELLER)
  const profiles = []

  for (let i = 0; i < sellers.length; i++) {
    const seller = sellers[i]
    const cityData = cities[i % cities.length]
    const coords = generateCoordinates({ lat: cityData.lat, lng: cityData.lng }, 15)

    const profile = await db.sellerProfile.create({
      data: {
        userId: seller.id,
        displayName: `${TEST_PREFIX} ${sellerNames[i]}`,
        bio: `Welcome to ${sellerNames[i]}! We're a small family farm dedicated to raising happy, healthy chickens. ${randomFromArray(listingDescriptions)}`,
        avatarUrl: `https://picsum.photos/seed/seller${i}/200/200`,
        address: `${randomBetween(100, 9999)} ${randomFromArray(['Oak', 'Maple', 'Pine', 'Cedar', 'Elm'])} ${randomFromArray(['St', 'Ave', 'Rd', 'Ln', 'Way'])}`,
        city: cityData.city,
        state: cityData.state,
        zip: String(randomBetween(10000, 99999)),
        lat: coords.lat,
        lng: coords.lng,
        maxDeliveryDistance: randomFromArray([null, 5, 10, 15, 20, 25]),
        pickupType: randomFromArray([PickupType.ARRANGED, PickupType.HOURS, PickupType.TIMESLOT]),
        pickupHours: {
          monday: { open: '09:00', close: '17:00' },
          tuesday: { open: '09:00', close: '17:00' },
          wednesday: { open: '09:00', close: '17:00' },
          thursday: { open: '09:00', close: '17:00' },
          friday: { open: '09:00', close: '17:00' },
          saturday: { open: '10:00', close: '14:00' },
          sunday: null,
        },
        isActive: i < 8, // Some profiles inactive
        autoAcceptOrders: i % 3 !== 0, // 2/3 auto-accept
        paymentMethod: i < 3 ? PaymentMethod.OWN_STRIPE : PaymentMethod.PLATFORM,
        stripeAccountId: i < 3 ? `acct_test_${i + 1}` : null,
        stripeOnboarded: i < 3,
      },
    })
    profiles.push(profile)
    console.log(`  ✓ Profile: ${profile.displayName}`)
  }

  return profiles
}

async function seedListings(profiles: Awaited<ReturnType<typeof seedSellerProfiles>>, tags: Awaited<ReturnType<typeof seedTags>>) {
  console.log('🥚 Creating listings...')

  const listings = []

  for (const profile of profiles) {
    const numListings = randomBetween(1, 5)

    for (let i = 0; i < numListings; i++) {
      const unit = randomFromArray([PricingUnit.DOZEN, PricingUnit.HALF_DOZEN, PricingUnit.EGG, PricingUnit.FLAT, PricingUnit.CUSTOM])
      const eggType = randomFromArray(eggTypes)
      const quality = randomFromArray(eggQualities)
      const color = randomFromArray(eggColors)

      // Get user's subscription status to determine hiddenBySubscription
      const user = await db.user.findUnique({ where: { id: profile.userId } })
      const isHidden = user?.subscriptionStatus !== SubscriptionStatus.ACTIVE && user?.subscriptionStatus !== SubscriptionStatus.NONE

      const listing = await db.eggListing.create({
        data: {
          sellerId: profile.id,
          title: `${TEST_PREFIX} ${quality.name} ${color.name} ${eggType.name} Eggs`,
          description: randomFromArray(listingDescriptions),
          pricePerUnit: unit === PricingUnit.DOZEN ? randomFloat(4, 12) :
                        unit === PricingUnit.HALF_DOZEN ? randomFloat(2.5, 7) :
                        unit === PricingUnit.EGG ? randomFloat(0.5, 1.5) :
                        unit === PricingUnit.FLAT ? randomFloat(12, 25) :
                        randomFloat(5, 15),
          unit,
          customUnitName: unit === PricingUnit.CUSTOM ? 'Baker\'s Dozen' : null,
          customUnitQty: unit === PricingUnit.CUSTOM ? 13 : null,
          stockCount: randomBetween(0, 50),
          isAvailable: randomBetween(1, 10) > 2, // 80% available
          hiddenBySubscription: isHidden,
          photos: [
            `https://picsum.photos/seed/egg${profile.id}${i}a/400/300`,
            `https://picsum.photos/seed/egg${profile.id}${i}b/400/300`,
          ],
          tags: {
            connect: [
              { slug: eggType.slug },
              { slug: quality.slug },
              { slug: color.slug },
            ].filter(() => Math.random() > 0.3), // Randomly connect 70% of tags
          },
        },
      })
      listings.push(listing)
    }
  }

  console.log(`  ✓ ${listings.length} listings created`)
  return listings
}

async function seedOrders(
  users: Awaited<ReturnType<typeof seedUsers>>,
  profiles: Awaited<ReturnType<typeof seedSellerProfiles>>,
  listings: Awaited<ReturnType<typeof seedListings>>
) {
  console.log('📦 Creating orders...')

  const buyers = users.filter(u => u.role === UserRole.BUYER)
  const orders = []
  const statuses = Object.values(OrderStatus)

  for (const buyer of buyers) {
    const numOrders = randomBetween(2, 6)

    for (let i = 0; i < numOrders; i++) {
      const listing = randomFromArray(listings)
      const profile = profiles.find(p => p.id === listing.sellerId)!
      const quantity = randomBetween(1, 5)
      const totalPrice = listing.pricePerUnit * quantity
      const platformFee = totalPrice * 0.02
      const status = randomFromArray(statuses)
      const fulfillmentType = randomFromArray([FulfillmentType.PICKUP, FulfillmentType.DELIVERY])

      const now = new Date()
      const createdAt = new Date(now.getTime() - randomBetween(1, 30) * 24 * 60 * 60 * 1000)

      const order = await db.order.create({
        data: {
          buyerId: buyer.id,
          sellerId: profile.id,
          listingId: listing.id,
          quantity,
          totalPrice,
          platformFee,
          status,
          fulfillmentType,
          pickupTime: fulfillmentType === FulfillmentType.PICKUP 
            ? new Date(createdAt.getTime() + randomBetween(1, 7) * 24 * 60 * 60 * 1000)
            : null,
          deliveryAddress: fulfillmentType === FulfillmentType.DELIVERY
            ? `${randomBetween(100, 999)} Test Street`
            : null,
          deliveryLat: fulfillmentType === FulfillmentType.DELIVERY ? profile.lat : null,
          deliveryLng: fulfillmentType === FulfillmentType.DELIVERY ? profile.lng : null,
          stripePaymentId: [OrderStatus.PAID, OrderStatus.COMPLETED].includes(status)
            ? `pi_test_${Date.now()}_${i}`
            : null,
          paidAt: [OrderStatus.PAID, OrderStatus.COMPLETED].includes(status)
            ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
            : null,
          completedAt: status === OrderStatus.COMPLETED
            ? new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000)
            : null,
          cancelledAt: [OrderStatus.CANCELLED, OrderStatus.DECLINED].includes(status)
            ? new Date(createdAt.getTime() + 12 * 60 * 60 * 1000)
            : null,
          cancelReason: status === OrderStatus.CANCELLED ? 'Test cancellation' : null,
          createdAt,
        },
      })
      orders.push(order)

      // Create order status history
      await db.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: OrderStatus.PENDING,
          changedByType: ChangeActorType.BUYER,
          changedBy: buyer.clerkId,
          createdAt,
        },
      })

      // Add more history entries based on status
      if ([OrderStatus.CONFIRMED, OrderStatus.PAID, OrderStatus.COMPLETED].includes(status)) {
        await db.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: OrderStatus.PENDING,
            toStatus: OrderStatus.CONFIRMED,
            changedByType: ChangeActorType.SELLER,
            changedBy: (await db.user.findUnique({ where: { id: profile.userId } }))?.clerkId,
            createdAt: new Date(createdAt.getTime() + 6 * 60 * 60 * 1000),
          },
        })
      }

      if ([OrderStatus.PAID, OrderStatus.COMPLETED].includes(status)) {
        await db.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: OrderStatus.CONFIRMED,
            toStatus: OrderStatus.PAID,
            changedByType: ChangeActorType.SYSTEM,
            reason: 'Stripe payment confirmed',
            metadata: { stripePaymentId: order.stripePaymentId },
            createdAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
          },
        })
      }

      if (status === OrderStatus.COMPLETED) {
        await db.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: OrderStatus.PAID,
            toStatus: OrderStatus.COMPLETED,
            changedByType: ChangeActorType.SELLER,
            changedBy: (await db.user.findUnique({ where: { id: profile.userId } }))?.clerkId,
            createdAt: new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000),
          },
        })
      }
    }
  }

  console.log(`  ✓ ${orders.length} orders created`)
  return orders
}

async function seedConversationsAndMessages(
  users: Awaited<ReturnType<typeof seedUsers>>,
  orders: Awaited<ReturnType<typeof seedOrders>>
) {
  console.log('💬 Creating conversations and messages...')

  const buyers = users.filter(u => u.role === UserRole.BUYER)
  const sellers = users.filter(u => u.role === UserRole.SELLER)
  const conversations = []
  const messages = []

  // Create conversations for some orders
  const ordersWithConvo = orders.slice(0, Math.floor(orders.length / 2))

  for (const order of ordersWithConvo) {
    const sellerProfile = await db.sellerProfile.findUnique({ where: { id: order.sellerId } })
    if (!sellerProfile) continue

    const sellerUser = await db.user.findUnique({ where: { id: sellerProfile.userId } })
    if (!sellerUser) continue

    // Check if conversation already exists
    const existingConvo = await db.conversation.findFirst({
      where: {
        buyerId: order.buyerId,
        sellerId: sellerUser.id,
      },
    })

    if (existingConvo) continue

    const convo = await db.conversation.create({
      data: {
        buyerId: order.buyerId,
        sellerId: sellerUser.id,
        orderId: order.id,
      },
    })
    conversations.push(convo)

    // Add messages
    const numMessages = randomBetween(2, 6)
    let messageTime = order.createdAt

    for (let i = 0; i < numMessages; i++) {
      const isBuyer = i % 2 === 0
      const senderId = isBuyer ? order.buyerId : sellerUser.id
      const content = randomFromArray(isBuyer ? messageTemplates.buyer : messageTemplates.seller)

      messageTime = new Date(messageTime.getTime() + randomBetween(5, 120) * 60 * 1000)

      const msg = await db.message.create({
        data: {
          conversationId: convo.id,
          senderId,
          content,
          read: i < numMessages - 1 || Math.random() > 0.3, // Last message often unread
          createdAt: messageTime,
        },
      })
      messages.push(msg)
    }
  }

  // Create some direct conversations (not order-related)
  for (let i = 0; i < 3; i++) {
    const buyer = randomFromArray(buyers)
    const seller = randomFromArray(sellers)

    const existingConvo = await db.conversation.findFirst({
      where: { buyerId: buyer.id, sellerId: seller.id },
    })

    if (existingConvo) continue

    const convo = await db.conversation.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
      },
    })
    conversations.push(convo)

    // Add a few messages
    for (let j = 0; j < 3; j++) {
      const isBuyer = j % 2 === 0
      const senderId = isBuyer ? buyer.id : seller.id

      await db.message.create({
        data: {
          conversationId: convo.id,
          senderId,
          content: randomFromArray(isBuyer ? messageTemplates.buyer : messageTemplates.seller),
          read: Math.random() > 0.4,
        },
      })
    }
  }

  console.log(`  ✓ ${conversations.length} conversations created`)
  console.log(`  ✓ ${messages.length}+ messages created`)
}

async function seedFavorites(
  users: Awaited<ReturnType<typeof seedUsers>>,
  profiles: Awaited<ReturnType<typeof seedSellerProfiles>>
) {
  console.log('❤️ Creating favorites...')

  const buyers = users.filter(u => u.role === UserRole.BUYER)
  let count = 0

  for (const buyer of buyers) {
    const numFavorites = randomBetween(1, 4)
    const favoriteProfiles = profiles
      .sort(() => Math.random() - 0.5)
      .slice(0, numFavorites)

    for (const profile of favoriteProfiles) {
      await db.favorite.create({
        data: {
          userId: buyer.id,
          sellerProfileId: profile.id,
        },
      })
      count++
    }
  }

  console.log(`  ✓ ${count} favorites created`)
}

async function seedMonthlyVolumes(profiles: Awaited<ReturnType<typeof seedSellerProfiles>>) {
  console.log('📊 Creating monthly volumes...')

  const now = new Date()
  let count = 0

  for (const profile of profiles) {
    // Create volume records for past 3 months
    for (let monthsAgo = 0; monthsAgo < 3; monthsAgo++) {
      const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)

      const totalSales = randomFloat(0, 3000)
      const feeTier = totalSales < 500 ? FeeTier.FREE :
                      totalSales < 2000 ? FeeTier.STARTER :
                      FeeTier.PRO

      await db.sellerMonthlyVolume.create({
        data: {
          sellerId: profile.id,
          month: date.getMonth() + 1,
          year: date.getFullYear(),
          totalSales,
          feeTier,
        },
      })
      count++
    }
  }

  console.log(`  ✓ ${count} monthly volume records created`)
}

async function seedPosts(profiles: Awaited<ReturnType<typeof seedSellerProfiles>>) {
  console.log('📝 Creating posts...')

  const postContents = [
    'Fresh eggs collected this morning! Come get them while they last. 🥚',
    'Our new batch of heritage breed chickens are starting to lay. Beautiful blue and green eggs!',
    'Special this week: Buy 2 dozen, get 1 free! Limited time offer.',
    'Thank you all for your continued support! We just reached 100 happy customers. 🎉',
    'Farm update: We\'re expanding our pasture area. The girls are going to love it!',
    'New pickup hours starting next week: 8am-6pm on weekdays.',
    'Just added duck eggs to our offerings! Rich and perfect for baking.',
  ]

  let count = 0

  for (const profile of profiles.slice(0, 7)) {
    const numPosts = randomBetween(1, 3)

    for (let i = 0; i < numPosts; i++) {
      await db.post.create({
        data: {
          sellerId: profile.id,
          content: `${TEST_PREFIX} ${randomFromArray(postContents)}`,
          imageUrl: Math.random() > 0.5 ? `https://picsum.photos/seed/post${profile.id}${i}/600/400` : null,
          createdAt: new Date(Date.now() - randomBetween(1, 14) * 24 * 60 * 60 * 1000),
        },
      })
      count++
    }
  }

  console.log(`  ✓ ${count} posts created`)
}

async function main() {
  console.log('🌱 Starting Eggbook seed script...\n')
  console.log(`Using test prefix: "${TEST_PREFIX}" and clerk prefix: "${TEST_CLERK_PREFIX}"\n`)

  try {
    // Check for existing test data
    const existingTestUsers = await db.user.count({
      where: { clerkId: { startsWith: TEST_CLERK_PREFIX } },
    })

    if (existingTestUsers > 0) {
      console.log(`⚠️  Found ${existingTestUsers} existing test users.`)
      console.log('   Run "npx tsx scripts/cleanup.ts" first to remove existing test data.\n')
      process.exit(1)
    }

    // Create seed data
    const tags = await seedTags()
    const users = await seedUsers()
    const profiles = await seedSellerProfiles(users)
    const listings = await seedListings(profiles, tags)
    const orders = await seedOrders(users, profiles, listings)
    await seedConversationsAndMessages(users, orders)
    await seedFavorites(users, profiles)
    await seedMonthlyVolumes(profiles)
    await seedPosts(profiles)

    console.log('\n✅ Seed completed successfully!')
    console.log('\nSummary:')
    console.log(`  - ${users.length} users (1 admin, ${sellerNames.length} sellers, ${buyerNames.length} buyers)`)
    console.log(`  - ${profiles.length} seller profiles`)
    console.log(`  - ${listings.length} egg listings`)
    console.log(`  - ${orders.length} orders`)
    console.log(`  - Tags, conversations, messages, favorites, volumes, and posts`)
    console.log('\nTo clean up test data, run: npx tsx scripts/cleanup.ts')

  } catch (error) {
    console.error('❌ Seed failed:', error)
    process.exit(1)
  } finally {
    await db.$disconnect()
    await pool.end()
  }
}

main()
