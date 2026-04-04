import Stripe from 'stripe'

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }
  return new Stripe(key, {
    apiVersion: '2026-03-25.dahlia',
    typescript: true,
  })
}

// Lazy-initialized stripe client
let _stripe: Stripe | null = null
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    if (!_stripe) _stripe = getStripeClient()
    return (_stripe as unknown as Record<string, unknown>)[prop as string]
  },
})

// Create a Stripe Connect account for a seller
export async function createConnectAccount(email: string) {
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  })
  return account
}

// Generate onboarding link for Stripe Connect
export async function createAccountLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
) {
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  })
  return link.url
}

// Create a payment intent for an order
export async function createPaymentIntent(
  amount: number, // in cents
  sellerId: string, // Stripe Connect account ID
  platformFee: number, // in cents
  metadata: Record<string, string>
) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    application_fee_amount: platformFee,
    transfer_data: {
      destination: sellerId,
    },
    metadata,
  })
  return paymentIntent
}

// Create a checkout session
export async function createCheckoutSession(
  orderId: string,
  amount: number, // in cents
  sellerStripeAccountId: string | null,
  platformFee: number, // in cents
  successUrl: string,
  cancelUrl: string
) {
  // Use Connect transfers if seller has Stripe account and Connect is enabled
  const useConnect = !!sellerStripeAccountId && process.env.STRIPE_CONNECT_ENABLED !== 'false'
  
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Egg Order',
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: useConnect
      ? {
          application_fee_amount: platformFee,
          transfer_data: {
            destination: sellerStripeAccountId!,
          },
          metadata: { orderId },
        }
      : {
          metadata: { orderId },
        },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { orderId },
  })
  return session
}

// Retrieve account status
export async function getAccountStatus(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)
  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  }
}

// Issue a refund
export async function createRefund(paymentIntentId: string, amount?: number) {
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount, // If undefined, refunds the full amount
  })
  return refund
}
