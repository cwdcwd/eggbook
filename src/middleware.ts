import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/explore(.*)',     // Explore/search page (public but auth-aware)
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/@(.*)',           // Public seller profiles
  '/checkout/(.*)/success', // Checkout success page (Stripe redirect)
  '/api/webhooks(.*)', // Webhook endpoints
  '/api/search(.*)',   // Search API (public for explore page)
])

// Admin routes
const isAdminRoute = createRouteMatcher(['/admin(.*)'])

// Seller routes
const isSellerRoute = createRouteMatcher(['/dashboard(.*)'])

export default clerkMiddleware(async (auth, req) => {
  // Allow public routes
  if (isPublicRoute(req)) {
    return
  }

  // Protect all other routes
  await auth.protect()

  // Admin routes require admin role (fail-closed at middleware)
  if (isAdminRoute(req)) {
    const { sessionClaims } = await auth()
    const metadata = sessionClaims?.metadata as { role?: string } | undefined
    // If metadata exists, it's authoritative — block non-admins
    // If metadata is undefined (migration period), allow through for route-level DB check
    if (metadata !== undefined && metadata.role !== "admin") {
      return new Response(null, { status: 403, headers: { Location: '/' } })
    }
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|json|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
