import 'dotenv/config';
import Stripe from 'stripe';
// A single SDK client keeps checkout, refunds and signature verification on the same configuration.
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' })
  : null;
