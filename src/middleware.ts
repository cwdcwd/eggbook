import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/@(.*)',           // Public seller profiles
  '/api/webhooks(.*)', // Webhook endpoints
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
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
