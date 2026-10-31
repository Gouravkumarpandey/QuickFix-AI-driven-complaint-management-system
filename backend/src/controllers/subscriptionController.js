import { User } from '../models/User.js';

/**
 * Get current user's subscription details
 */
export const getSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -otp -otpExpiry');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if subscription has expired
    let isExpired = false;
    if (user.planExpiresAt && new Date() > new Date(user.planExpiresAt)) {
      isExpired = true;
      // Auto-downgrade to Free plan if expired
      user.planType = 'Free';
      user.planExpiresAt = null;
      await user.save();
    }

    res.json({
      success: true,
      subscription: {
        planType: user.planType,
        planExpiresAt: user.planExpiresAt,
        isExpired,
        subscriptionId: user.subscriptionId,
        paymentHistory: user.paymentHistory || []
      }
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ message: 'Error fetching subscription details', error: error.message });
  }
};

/**
 * Upgrade user plan (after payment verification)
 */
export const upgradePlan = async (req, res) => {
  return res.status(409).json({ message: 'Complete Stripe checkout and verify the paid session to upgrade.' });
};

/**
 * Manually downgrade plan (for testing or admin action)
 */
export const downgradePlan = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.planType = 'Free';
    user.planExpiresAt = null;
    user.subscriptionId = null;
    await user.save();

    res.json({
      success: true,
      message: 'Successfully downgraded to Free plan',
      user: {
        id: user._id,
        planType: user.planType,
        planExpiresAt: user.planExpiresAt
      }
    });
  } catch (error) {
    console.error('Error downgrading plan:', error);
    res.status(500).json({ message: 'Error downgrading plan', error: error.message });
  }
};

/**
 * Get plan features (for displaying what each plan offers)
 */
export const getPlanFeatures = (req, res) => {
  const plans = {
    Free: {
      name: 'Free',
      price: 0,
      currency: 'INR',
      features: [
        'Basic issue reporting',
        'Community support',
        'Email notifications',
        'Up to 5 complaints per month',
        'Standard response time (48-72 hours)'
      ],
      limitations: [
        'No AI diagnosis',
        'No priority support',
        'No live chat',
        'No analytics dashboard'
      ]
    },
    Pro: {
      name: 'Pro',
      price: 499,
      currency: 'INR',
      priceLabel: '₹499/month',
      features: [
        'Everything in Free',
        'AI-powered diagnosis suggestions',
        'Priority support (24-hour response)',
        'Live chat with agents',
        'Unlimited complaints',
        'Analytics dashboard',
        'Email & SMS notifications',
        'Complaint history & tracking'
      ],
      limitations: [
        'No team management',
        'No custom branding',
        'No API access'
      ]
    },
    Premium: {
      name: 'Premium',
      price: 999,
      currency: 'INR',
      priceLabel: '₹999/month',
      features: [
        'Everything in Pro',
        'Real-time monitoring & alerts',
        'Team management (up to 10 users)',
        'Custom branding',
        'API access',
        'Video call support with agents',
        'Dedicated account manager',
        'Advanced analytics & reports',
        'Priority escalation',
        'Custom workflows',
        'Integration support'
      ],
      limitations: []
    }
  };

  res.json({ success: true, plans });
};

/**
 * Check feature access for current user
 */
export const checkFeatureAccess = async (req, res) => {
  try {
    const { feature } = req.query;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if plan is expired
    if (user.planExpiresAt && new Date() > new Date(user.planExpiresAt)) {
      user.planType = 'Free';
      user.planExpiresAt = null;
      await user.save();
    }

    // Feature access mapping
    const featureAccess = {
      'ai-diagnosis': ['Pro', 'Premium'],
      'live-chat': ['Pro', 'Premium'],
      'video-call': ['Premium'],
      'analytics': ['Pro', 'Premium'],
      'team-management': ['Premium'],
      'custom-branding': ['Premium'],
      'api-access': ['Premium'],
      'priority-support': ['Pro', 'Premium'],
      'real-time-alerts': ['Premium']
    };

    const hasAccess = featureAccess[feature]?.includes(user.planType) || false;

    res.json({
      success: true,
      hasAccess,
      currentPlan: user.planType,
      requiredPlans: featureAccess[feature] || []
    });
  } catch (error) {
    console.error('Error checking feature access:', error);
    res.status(500).json({ message: 'Error checking feature access', error: error.message });
  }
};

/**
 * Admin function to manually set user plan (for testing or special cases)
 */
export const adminSetPlan = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { userId, planType, duration = 30 } = req.body;

    if (!['Free', 'Pro', 'Premium'].includes(planType)) {
      return res.status(400).json({ message: 'Invalid plan type' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.planType = planType;
    
    if (planType !== 'Free') {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + duration);
      user.planExpiresAt = expiryDate;
    } else {
      user.planExpiresAt = null;
    }

    await user.save();

    res.json({
      success: true,
      message: `User plan updated to ${planType}`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        planType: user.planType,
        planExpiresAt: user.planExpiresAt
      }
    });
  } catch (error) {
    console.error('Error setting user plan:', error);
    res.status(500).json({ message: 'Error setting user plan', error: error.message });
  }
};

/**
 * Get subscription statistics (admin only)
 */
export const getSubscriptionStats = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const [freeUsers, proUsers, premiumUsers, expiredUsers] = await Promise.all([
      User.countDocuments({ planType: 'Free' }),
      User.countDocuments({ planType: 'Pro', planExpiresAt: { $gt: new Date() } }),
      User.countDocuments({ planType: 'Premium', planExpiresAt: { $gt: new Date() } }),
      User.countDocuments({ 
        planType: { $in: ['Pro', 'Premium'] },
        planExpiresAt: { $lt: new Date() }
      })
    ]);

    // Calculate total revenue (simplified)
    const proRevenue = proUsers * 499;
    const premiumRevenue = premiumUsers * 999;
    const totalRevenue = proRevenue + premiumRevenue;

    res.json({
      success: true,
      stats: {
        totalUsers: freeUsers + proUsers + premiumUsers,
        freeUsers,
        proUsers,
        premiumUsers,
        expiredUsers,
        revenue: {
          total: totalRevenue,
          pro: proRevenue,
          premium: premiumRevenue,
          currency: 'INR'
        }
      }
    });
  } catch (error) {
    console.error('Error fetching subscription stats:', error);
    res.status(500).json({ message: 'Error fetching subscription stats', error: error.message });
  }
};
