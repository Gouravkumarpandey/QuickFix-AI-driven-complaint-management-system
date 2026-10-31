import api from '../utils/api';
import { 
  Subscription, 
  PlanDetails, 
  PlanType, 
  FeatureAccess, 
  StripeCheckoutSession,
  SubscriptionStats,
  PaymentRecord,
  UpgradeResponse,
  DowngradeResponse,
  VerifyPaymentResponse,
  PaymentError,
  RefundResponse,
  AllPaymentsResponse
} from '../types/subscription';

// Using shared Axios instance from utils/api.ts
// All requests automatically include credentials and auth headers

export const subscriptionService = {
  /**
   * Get current user's subscription details
   */
  getCurrentSubscription: async (): Promise<Subscription> => {
    const response = await api.get('/subscriptions/current');
    return response.data.subscription;
  },

  /**
   * Get all available plan features
   */
  getPlanFeatures: async (): Promise<PlanDetails> => {
    const response = await api.get('/subscriptions/plans');
    return response.data.plans;
  },

  /**
   * Check if user has access to a specific feature
   */
  checkFeatureAccess: async (feature: string): Promise<FeatureAccess> => {
    const response = await api.get(`/subscriptions/feature-access?feature=${feature}`);
    return response.data;
  },

  /**
   * Upgrade user plan (after payment verification)
   */
  upgradePlan: async (
    planType: PlanType,
    orderId: string,
    paymentId: string,
    amount: number,
    duration?: number
  ): Promise<UpgradeResponse> => {
    const response = await api.post('/subscriptions/upgrade', {
      planType,
      orderId,
      paymentId,
      amount,
      duration,
    });
    return response.data;
  },

  /**
   * Downgrade to free plan
   */
  downgradePlan: async (): Promise<DowngradeResponse> => {
    const response = await api.post('/subscriptions/downgrade');
    return response.data;
  },

  /**
   * Get Stripe publishable key
   */
  getStripeKey: async (): Promise<string> => {
    const response = await api.get('/payments/key');
    return response.data.key;
  },

  /**
   * Create Stripe checkout session
   */
  createCheckoutSession: async (planType: PlanType): Promise<StripeCheckoutSession> => {
    const response = await api.post('/payments/create-checkout-session', { planType });
    return response.data;
  },

  /**
   * Verify Stripe payment
   */
  verifyPayment: async (
    sessionId: string
  ): Promise<VerifyPaymentResponse> => {
    const response = await api.post('/payments/verify', {
      sessionId,
    });
    return response.data;
  },

  /**
   * Get payment history
   */
  getPaymentHistory: async (): Promise<PaymentRecord[]> => {
    const response = await api.get('/payments/history');
    return response.data.paymentHistory;
  },

  /**
   * Redirect to Stripe checkout
   */
  redirectToCheckout: async (
    planType: PlanType,
    onError: (error: PaymentError) => void
  ): Promise<void> => {
    try {
      // Create checkout session
      const session = await subscriptionService.createCheckoutSession(planType);
      
      // Redirect to Stripe checkout
      window.location.href = session.url;
    } catch (error) {
      console.error('Error redirecting to checkout:', error);
      onError({ 
        message: error instanceof Error ? error.message : 'Failed to create checkout session' 
      });
    }
  },

  // Admin endpoints
  admin: {
    /**
     * Set user plan (admin only)
     */
    setUserPlan: async (
      userId: string,
      planType: PlanType,
      duration?: number
    ): Promise<UpgradeResponse> => {
      const response = await api.post('/subscriptions/admin/set-plan', {
        userId,
        planType,
        duration,
      });
      return response.data;
    },

    /**
     * Get subscription statistics (admin only)
     */
    getSubscriptionStats: async (): Promise<SubscriptionStats> => {
      const response = await api.get('/subscriptions/admin/stats');
      return response.data.stats;
    },

    /**
     * Get all payments (admin only)
     */
    getAllPayments: async (): Promise<AllPaymentsResponse[]> => {
      const response = await api.get('/payments/all');
      return response.data.payments;
    },

    /**
     * Refund payment (admin only)
     */
    refundPayment: async (paymentIntentId: string, amount?: number, idempotencyKey: string = crypto.randomUUID()): Promise<RefundResponse> => {
      const response = await api.post('/payments/refund', {
        paymentIntentId,
        amount,
      }, { headers: { 'Idempotency-Key': idempotencyKey } });
      return response.data;
    },
  },
};

export default subscriptionService;
