import { fulfillPayment } from '../services/paymentService.js';
import Stripe from 'stripe';
import { User } from '../models/User.js';

// Initialize Stripe instance only if API key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-11-20.acacia',
  });
  console.log('✅ Stripe payment service initialized');
} else {
  console.warn('⚠️  STRIPE_SECRET_KEY not set. Payment features will be disabled.');
}

/**
 * Get Stripe publishable key for frontend
 */
export const getStripeKey = (req, res) => {
  res.json({
    success: true,
    key: process.env.STRIPE_PUBLISHABLE_KEY || ''
  });
};

/**
 * Create Stripe checkout session for plan purchase
 */
export const createCheckoutSession = async (req, res) => {
  try {
    // Check if Stripe is configured
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Payment processing is temporarily unavailable. Please try again later or contact support.',
        code: 'PAYMENT_SERVICE_UNAVAILABLE'
      });
    }

    const { planType } = req.body;
    const userId = req.user.id;

    // Validate plan type
    if (!['Pro', 'Premium'].includes(planType)) {
      return res.status(400).json({ message: 'Invalid plan type' });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Define plan prices (in paise for INR)
    const planPrices = {
      Pro: 49900, // ₹499
      Premium: 99900 // ₹999
    };

    const amount = planPrices[planType];

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: `${planType} Plan`,
              description: `QuickFix ${planType} subscription for 30 days`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
      client_reference_id: userId.toString(),
      customer_email: user.email,
      metadata: {
        userId: userId.toString(),
        planType,
        userName: user.name,
      },
    });

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
      planType,
    });
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    res.status(500).json({
      message: 'Error creating payment session',
      error: error.message
    });
  }
};

/**
 * Verify Stripe payment and complete order
 */
export const verifyPayment = async (req, res) => {
  try {
    // Check if Stripe is configured
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: 'Payment service is not configured. Please contact support.'
      });
    }

    const { sessionId } = req.body;
    const userId = req.user.id;

    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Verify the session belongs to this user
    if (session.client_reference_id !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Payment verification failed - user mismatch'
      });
    }

    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const planType = session.metadata.planType;

    const fulfilledUser = await fulfillPayment(session);
    user.planType = fulfilledUser.planType;
    user.planExpiresAt = fulfilledUser.planExpiresAt;

    res.json({
      success: true,
      message: 'Payment verified successfully',
      planType: user.planType,
      planExpiresAt: user.planExpiresAt,
      paymentDetails: {
        orderId: session.id,
        paymentId: session.payment_intent,
        amount: session.amount_total / 100,
        currency: session.currency
      }
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      message: 'Error verifying payment',
      error: error.message
    });
  }
};

/**
 * Get payment history for current user
 */
export const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select('paymentHistory');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      paymentHistory: user.paymentHistory || []
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({
      message: 'Error fetching payment history',
      error: error.message
    });
  }
};

/**
 * Webhook handler for Stripe events
 * This is called by Stripe when payment status changes
 */
export const webhookHandler = async (req, res) => {
  // Check if Stripe is configured
  if (!stripe) {
    return res.status(503).json({
      success: false,
      message: 'Payment service is not configured.'
    });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle different webhook events
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        console.log('Payment succeeded:', session.id);

        // Update user plan if not already updated
        if (session.payment_status === 'paid') {
          await fulfillPayment(session);
        }
        break;

      case 'payment_intent.payment_failed':
        const paymentIntent = event.data.object;
        console.log('Payment failed:', paymentIntent.id);
        break;

      case 'charge.refunded':
        const charge = event.data.object;
        console.log('Charge refunded:', charge.id);
        break;

      default:
        console.log('Unhandled webhook event:', event.type);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({
      message: 'Error processing webhook',
      error: error.message
    });
  }
};

/**
 * Refund payment (admin only)
 */
export const refundPayment = async (req, res) => {
  try {
    // Check if Stripe is configured
    if (!stripe) {
      return res.status(503).json({
        message: 'Payment service is not configured. Please contact support.'
      });
    }

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { paymentIntentId, amount } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ message: 'Payment Intent ID is required' });
    }

    // Create refund
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? amount * 100 : undefined, // Convert to cents if amount provided (partial refund)
    });

    res.json({
      success: true,
      message: 'Refund initiated successfully',
      refund: {
        id: refund.id,
        amount: refund.amount / 100,
        status: refund.status,
        createdAt: new Date(refund.created * 1000)
      }
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({
      message: 'Error processing refund',
      error: error.message
    });
  }
};

/**
 * Get all payments (admin only)
 */
export const getAllPayments = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const users = await User.find({
      paymentHistory: { $exists: true, $ne: [] }
    }).select('name email paymentHistory planType');

    // Flatten all payment records
    const allPayments = [];
    users.forEach(user => {
      user.paymentHistory.forEach(payment => {
        allPayments.push({
          ...payment.toObject(),
          userName: user.name,
          userEmail: user.email,
          currentPlan: user.planType
        });
      });
    });

    // Sort by date (newest first)
    allPayments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      payments: allPayments,
      totalPayments: allPayments.length
    });
  } catch (error) {
    console.error('Error fetching all payments:', error);
    res.status(500).json({
      message: 'Error fetching payments',
      error: error.message
    });
  }
};
