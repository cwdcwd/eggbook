# Plan: Eggbook PWA - Egg Marketplace

## TL;DR
Build a Progressive Web App marketplace where egg sellers create profile pages (`@username`), list eggs with tags/photos/pricing, and buyers can browse, request orders, message sellers, and pay via Stripe. Tech stack: **Next.js 14 App Router + Tailwind CSS + Clerk Auth + PostgreSQL + Stripe**.

---

## Tech Stack Summary

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Auth | Clerk (email/password + Google, Facebook, Apple) |
| Database | Vercel Postgres |
| File Storage | Vercel Blob |
| Real-time | Pusher |
| Payments | Stripe (Connect for marketplace) |
| Maps | Mapbox or Google Maps |
| PWA | next-pwa |
| Hosting | Vercel |

---

## Phase 1: Project Foundation

### 1.1 Initialize Project
- Create Next.js 14 app with TypeScript, Tailwind CSS, ESLint
- Configure PWA with `next-pwa` (manifest, service worker, icons)
- Set up Vercel project & environment variables

### 1.2 Database Setup
- Create Vercel Postgres database
- Design schema (see Data Model below)
- Set up Prisma ORM with migrations

### 1.3 Auth Integration
- Configure Clerk with email/password + social providers (Google, Facebook, Apple)
- Create middleware for protected routes
- Build sign-up flow with role selection (buyer/seller)

---

## Phase 2: Core Data Model

### Database Schema (Prisma)

```
User (synced from Clerk)
├── id, clerkId, username, email, role, createdAt

SellerProfile
├── id, userId, displayName, bio, avatarUrl
├── address, city, state, zip, lat, lng
├── maxDeliveryDistance (miles)
├── pickupType (TIMESLOT | HOURS | ARRANGED)
├── pickupHours, isActive, createdAt

EggListing
├── id, sellerId, title, description
├── eggType, pricePerUnit, unit (EGG | HALF_DOZEN | DOZEN | CUSTOM)
├── customUnitName, customUnitQty
├── stockCount, isAvailable, photos[]
├── tags[], createdAt, updatedAt

Tag
├── id, name, slug (chicken, duck, organic, free-range, etc.)

Order
├── id, buyerId, sellerId, listingId
├── quantity, totalPrice, status (PENDING | CONFIRMED | COMPLETED | CANCELLED)
├── fulfillmentType (PICKUP | DELIVERY)
├── pickupTime, deliveryAddress
├── stripePaymentId, paidAt, createdAt

Message
├── id, conversationId, senderId, content, createdAt

Conversation
├── id, buyerId, sellerId, orderId (optional), createdAt

Favorite
├── id, userId, sellerId, createdAt

Post (Feed)
├── id, sellerId, content, imageUrl, createdAt

SellerMonthlyVolume (for fee tiers)
├── id, sellerId, month, year, totalSales, feeTier
```

---

## Phase 3: Seller Features

### 3.1 Seller Onboarding
- Profile setup wizard: display name, bio, avatar upload
- Location setup with address autocomplete + map pin
- Max delivery distance setting (miles)
- Pickup preference selection (time slots / hours / arranged)

### 3.2 Egg Listing Management
- Create/edit/delete listings
- Photo upload (multiple per listing, via Vercel Blob)
- Tag selector (multi-select from predefined + custom tags)
- Flexible pricing: select unit type, set price
- Stock count input with availability toggle

### 3.3 Order Management
- View incoming order requests
- Confirm/decline orders with optional message
- Mark orders as completed
- Basic order history

### 3.4 Post Feed (Seller Side)
- Create posts with text + optional photo
- Posts appear on seller profile + global feed

---

## Phase 4: Buyer Features

### 4.1 Discovery & Search
- Homepage with map view of nearby sellers
- Search by location (zip/city or "near me")
- Filter by egg type/tags, availability, pickup/delivery
- Distance-based sorting

### 4.2 Seller Profile Page (`/@username`)
- Profile header: name, avatar, bio, location, availability status
- Active egg listings grid with photos, prices, stock
- Posts feed
- Favorite button
- "Message Seller" / "Request Order" CTAs

### 4.3 Order Request Flow
- Select listing → choose quantity → choose pickup/delivery
- If pickup: select time slot OR see hours OR "arrange later"
- If delivery: enter address (validate within seller's max delivery distance)
- Review order → Submit request (no payment yet)
- Notification to seller

### 4.4 Checkout & Payment (Optional)
- After seller confirms, buyer receives notification
- "Pay Now" button triggers Stripe Checkout
- Stripe Connect sends funds to seller (minus platform fee based on tier)
- Order marked as paid

### 4.5 Messaging
- Conversation threads per seller (or per order)
- Real-time updates via Pusher
- Unread badge/notification

### 4.6 Favorites
- Save favorite sellers
- View favorites list in user profile

---

## Phase 5: Notifications

- Email notifications via Clerk or Resend:
  - New order request (seller)
  - Order confirmed/declined (buyer)
  - New message (both)
- Push notifications (PWA web push):
  - Service worker push events
  - Database notification preferences

---

## Phase 6: PWA Features

- Manifest with app name, icons, theme color
- Service worker for offline caching (static assets, cached data)
- Install prompt handling
- Mobile-optimized responsive design
- Add to home screen support

---

## Phase 7: Payments (Stripe Connect) & Fee Tiers

### 7.1 Stripe Connect
- Stripe Connect Express for marketplace payouts
- Seller onboarding flow: link Stripe account
- Payment intent creation on order confirmation
- Webhooks for payment success/failure

### 7.2 Volume-Based Fee Tiers
| Tier | Monthly Sales | Platform Fee |
|------|---------------|--------------|
| Free | $0-500 | 0% |
| Starter | $500-2,000 | 2% |
| Pro | $2,000+ | 3% |

- Track monthly sales volume per seller
- Apply fee tier automatically on each transaction
- Display current tier + progress in seller dashboard

---

## Phase 8: Admin Dashboard

### 8.1 Admin Authentication
- Superadmin role in Clerk
- Protected admin routes (`/admin/**`)

### 8.2 User Management
- View all users (sellers/buyers)
- Suspend/ban accounts
- View user activity

### 8.3 Listing Moderation
- Review flagged/reported listings
- Approve/reject/remove listings
- Content policy enforcement

### 8.4 Order & Dispute Management
- View all orders
- Handle disputes between buyers/sellers
- Issue refunds via Stripe

### 8.5 Analytics
- Platform-wide stats: users, orders, revenue
- Fee tier distribution
- Geographic distribution of sellers

---

## Relevant Files (to create)

```
/app
├── layout.tsx                    # Root layout with Clerk, PWA meta
├── page.tsx                      # Homepage with map + listings
├── (auth)/sign-in/[[...sign-in]]/page.tsx
├── (auth)/sign-up/[[...sign-up]]/page.tsx
├── @[username]/page.tsx          # Public seller profile
├── dashboard/
│   ├── page.tsx                  # Seller dashboard home
│   ├── listings/page.tsx         # Manage listings
│   ├── orders/page.tsx           # Order management
│   └── settings/page.tsx         # Profile settings
├── messages/page.tsx             # Messaging inbox
├── favorites/page.tsx            # Saved sellers
├── checkout/[orderId]/page.tsx   # Payment page
├── admin/
│   ├── layout.tsx                # Admin layout with sidebar
│   ├── page.tsx                  # Dashboard overview
│   ├── users/page.tsx            # User management
│   ├── listings/page.tsx         # Listing moderation
│   ├── orders/page.tsx           # Order/dispute management
│   └── analytics/page.tsx        # Platform analytics
└── api/
    ├── webhooks/stripe/route.ts
    ├── orders/route.ts
    └── messages/route.ts

/components
├── ui/                           # Reusable UI components
├── map/                          # Map components
├── listings/                     # Egg listing cards
└── messaging/                    # Chat components

/lib
├── db.ts                         # Prisma client
├── stripe.ts                     # Stripe helpers
└── auth.ts                       # Clerk helpers

/prisma
└── schema.prisma                 # Database schema
```

---

## Verification

1. **Auth**: Sign up/in with email + each social provider works
2. **Seller flow**: Create profile → set delivery radius → add listing with photos/tags → see on public page
3. **Buyer flow**: Search by location → view seller → favorite → request order
4. **Delivery validation**: Buyer outside max delivery distance sees "pickup only"
5. **Order flow**: Buyer requests → seller confirms → buyer pays → order completes
6. **Fee tiers**: Correct fee applied based on seller's monthly volume
7. **Messaging**: Start conversation → send/receive messages in real-time
8. **PWA**: Install on mobile → works offline → receives push notifications
9. **Payments**: Stripe test mode checkout → funds appear in seller dashboard
10. **Admin**: Can suspend user, remove listing, issue refund
11. **Responsive**: Test on desktop, tablet, mobile viewports

---

## Decisions

- **Clerk over NextAuth**: Better DX, built-in UI components, easier social auth setup
- **Vercel native services**: Vercel Postgres for DB, Vercel Blob for file storage, Pusher for real-time messaging
- **Stripe Connect Express**: Simplest marketplace payout setup
- **Request-based ordering**: Allows sellers to manage capacity, prevents overselling
- **Tag-based egg types**: Flexible, extensible, no rigid category structure
- **Max delivery distance**: Sellers set miles radius; buyer address validated against seller location
- **Volume-based fees**: Free tier for small sellers, scales with success
- **Admin dashboard**: Full moderation + dispute handling capabilities
