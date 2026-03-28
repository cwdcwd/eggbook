import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
  typescript: true,
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
  sellerStripeAccountId: string,
  platformFee: number, // in cents
  successUrl: string,
  cancelUrl: string
) {
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
    payment_intent_data: {
      application_fee_amount: platformFee,
      transfer_data: {
        destination: sellerStripeAccountId,
      },
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
