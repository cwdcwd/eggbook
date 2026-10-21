# Eggbook

A marketplace for farm-fresh local eggs. Buyers find and order eggs from sellers
nearby; sellers list their stock, manage pickup/delivery, and get paid.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19, TypeScript
- **Auth:** Clerk (`@clerk/nextjs`) — Google/email social & passwordless login,
  user sync via webhook
- **Database:** PostgreSQL (Neon / Vercel Postgres) via Prisma ORM
- **Payments:** Stripe (platform checkout + optional Stripe Connect for sellers)
- **Realtime:** Pusher Channels (order/message events) + Pusher Beams (push
  notifications)
- **Storage:** Vercel Blob (listing photos)
- **Rate limiting:** Upstash Redis (optional — no-op if unconfigured)
- **PWA:** manifest + Pusher Beams service worker (see `scripts/copy-sw.mjs`)

## Getting Started

```bash
git clone https://github.com/cwdcwd/eggbook.git
cd eggbook
npm install                 # runs prisma generate + SW copy via postinstall
cp .env.example .env        # then fill in real values (see Environment Variables)
npm run db:migrate          # apply Prisma migrations
npm run dev                 # http://localhost:3000
```

## Environment Variables

All variables live in `.env` (never commit it). See `.env.example` for the full
list:

| Variable | Required | Purpose |
|----------|----------|---------|
| `PRISMA_DATABASE_URL` | yes | Postgres connection string (Neon / Vercel Postgres) |
| `CLERK_WEBHOOK_SECRET` | yes | Svix secret for the `/api/webhooks/clerk` user-sync webhook |
| `STRIPE_SECRET_KEY` | yes | Stripe API key (checkout + Connect) |
| `STRIPE_WEBHOOK_SECRET` | yes | Stripe webhook signature verification |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk publishable (instance) key |
| `CLERK_SECRET_KEY` | yes | Clerk secret key |
| `NEXT_PUBLIC_APP_URL` | yes | App base URL — Stripe/Beams redirect + link building |
| `NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER` | yes | Realtime channels (client) |
| `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` | yes | Realtime channels (server) |
| `BLOB_READ_WRITE_TOKEN` | yes | Vercel Blob storage for listing photos |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | optional | API rate limiting; unset = rate limiting disabled (dev only) |
| `NEXT_PUBLIC_BEAMS_INSTANCE_ID` / `BEAMS_SECRET_KEY` | optional | Push notifications; unset = push disabled |
| `NEXT_PUBLIC_MAPBOX_TOKEN` or `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | optional | Seller map (choose one) |
| `DATABASE_URL` / `POSTGRES_URL` | no | Read by Vercel/Neon adapters; `PRISMA_DATABASE_URL` is the one Prisma uses |

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Prisma generate → copy SW → `next build` |
| `npm start` | Serve production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:seed` | Seed database (`scripts/seed.ts`) |
| `npm run db:cleanup` | Remove seed/test data (`--dry-run` available) |
| `npm run db:reset` | Cleanup + reseed |

## Architecture

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/             #   Clerk sign-in / sign-up pages
│   ├── [username]/         #   Public seller profiles
│   ├── admin/               #   Admin panel (requires ADMIN claim in Clerk)
│   ├── checkout/            #   Stripe checkout + success landing
│   ├── dashboard/           #   Seller/buyer dashboard (auth-protected)
│   ├── explore/             #   Public search (Mapbox/Google maps)
│   └── api/                 #   REST API routes
│       ├── webhooks/        #     Clerk + Stripe webhooks (signature-verified)
│       └── ...              #     orders, listings, favorites, settings, stripe, ...
├── components/             # UI components
├── lib/                    # Auth, db (Prisma), Stripe, Pusher, rate limiting
├── hooks/                   # Client hooks
└── middleware.ts           # Clerk route protection + admin gate (fail-closed)
```

- **User sync:** Clerk `user.created/updated/deleted` webhooks create/update
  the `User` row in Postgres; API routes fall back to `getOrCreateUser()` if the
  webhook hasn't landed yet.
- **Subscriptions:** Clerk Billing plans gate seller features (`has({feature})`
  checks); listing visibility is managed via `hiddenBySubscription`.
- **Payments:** platform checkout (fee tiers by monthly volume: 0%–3%) or
  seller-owned Stripe Connect accounts.

## Deployment

Deploys as a standard Next.js app on Vercel (all-in on the Vercel stack:
Postgres, Blob). Set all required environment variables in the project settings,
run `npm run db:migrate` against production once, then connect the repo —
Vercel's Git integration builds and deploys on push.

## License

Private project of cwdcwd.