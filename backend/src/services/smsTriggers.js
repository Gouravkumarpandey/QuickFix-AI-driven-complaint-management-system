import { notificationAllowed } from './notificationPreferences.js';
/**
 * SMS Event Triggers
 * This module contains functions to automatically trigger SMS notifications
 * when specific events occur in the system.
 */

import { sendSMS, SMS_EVENTS } from './smsService.js';
import User from '../models/User.js';

/**
 * Trigger SMS when a new user signs up
 * @param {Object} user - User object
 */
export const triggerSignupSMS = async (user) => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping signup SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.SIGNUP,
      userId: user._id
    });

    console.log(`✅ Signup SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending signup SMS:', error);
  }
};

/**
 * Trigger SMS for OTP generation
 * @param {Object} user - User object
 * @param {string} otp - One-time password
 * @param {number} expiryMinutes - OTP expiry time in minutes
 */
export const triggerOTPSMS = async (user, otp, expiryMinutes = 10) => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping OTP SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.OTP_GENERATION,
      eventData: { otp, expiryMinutes },
      userId: user._id
    });

    console.log(`✅ OTP SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending OTP SMS:', error);
  }
};

/**
 * Trigger SMS when password reset is requested
 * @param {Object} user - User object
 * @param {string} resetCode - Password reset code
 */
export const triggerPasswordResetSMS = async (user, resetCode) => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping password reset SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.PASSWORD_RESET,
      eventData: { resetCode },
      userId: user._id
    });

    console.log(`✅ Password reset SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending password reset SMS:', error);
  }
};

/**
 * Trigger SMS when interview is scheduled
 * @param {Object} user - User object
 * @param {string} date - Interview date
 * @param {string} time - Interview time
 * @param {string} location - Interview location
 */
export const triggerInterviewScheduledSMS = async (user, date, time, location = 'TBD') => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping interview SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.INTERVIEW_SCHEDULED,
      eventData: { date, time, location },
      userId: user._id
    });

    console.log(`✅ Interview scheduled SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending interview scheduled SMS:', error);
  }
};

/**
 * Trigger SMS for general reminders
 * @param {Object} user - User object
 * @param {string} reminderText - Reminder message
 */
export const triggerReminderSMS = async (user, reminderText) => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping reminder SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.REMINDER,
      eventData: { reminderText },
      userId: user._id
    });

    console.log(`✅ Reminder SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending reminder SMS:', error);
  }
};

/**
 * Trigger SMS when a complaint is created
 * @param {Object} user - User object
 * @param {string} complaintId - Complaint ID
 */
export const triggerComplaintCreatedSMS = async (user, complaintId) => {
  if (!notificationAllowed(user, 'sms', 'complaintUpdated')) return { skipped: true };
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping complaint created SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.COMPLAINT_CREATED,
      eventData: { complaintId },
      userId: user._id
    });

    console.log(`✅ Complaint created SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending complaint created SMS:', error);
  }
};

/**
 * Trigger SMS when a complaint is assigned to an agent
 * @param {Object} user - User object
 * @param {string} complaintId - Complaint ID
 * @param {string} agentName - Agent's name
 */
export const triggerComplaintAssignedSMS = async (user, complaintId, agentName) => {
  if (!notificationAllowed(user, 'sms', 'complaintAssigned')) return { skipped: true };
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping complaint assigned SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.COMPLAINT_ASSIGNED,
      eventData: { complaintId, agentName },
      userId: user._id
    });

    console.log(`✅ Complaint assigned SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending complaint assigned SMS:', error);
  }
};

/**
 * Trigger SMS when a complaint is resolved
 * @param {Object} user - User object
 * @param {string} complaintId - Complaint ID
 */
export const triggerComplaintResolvedSMS = async (user, complaintId) => {
  if (!notificationAllowed(user, 'sms', 'complaintResolved')) return { skipped: true };
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping complaint resolved SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.COMPLAINT_RESOLVED,
      eventData: { complaintId },
      userId: user._id
    });

    console.log(`✅ Complaint resolved SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending complaint resolved SMS:', error);
  }
};

/**
 * Trigger SMS when complaint status is updated
 * @param {Object} user - User object
 * @param {string} complaintId - Complaint ID
 * @param {string} status - New status
 * @param {string} additionalInfo - Additional information
 */
export const triggerStatusUpdateSMS = async (user, complaintId, status, additionalInfo = '') => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping status update SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.STATUS_UPDATE,
      eventData: { complaintId, status, additionalInfo },
      userId: user._id
    });

    console.log(`✅ Status update SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending status update SMS:', error);
  }
};

/**
 * Trigger SMS for successful payment
 * @param {Object} user - User object
 * @param {number} amount - Payment amount
 * @param {string} currency - Currency code
 * @param {string} transactionId - Transaction ID
 */
export const triggerPaymentSuccessSMS = async (user, amount, currency, transactionId) => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping payment success SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.PAYMENT_SUCCESS,
      eventData: { amount, currency, transactionId },
      userId: user._id
    });

    console.log(`✅ Payment success SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending payment success SMS:', error);
  }
};

/**
 * Trigger SMS for failed payment
 * @param {Object} user - User object
 * @param {number} amount - Payment amount
 * @param {string} currency - Currency code
 */
export const triggerPaymentFailedSMS = async (user, amount, currency) => {
  try {
    if (!user.phoneNumber) {
      console.log('⚠️  User has no phone number, skipping payment failed SMS');
      return;
    }

    await sendSMS({
      userName: user.name || user.firstName || 'User',
      phoneNumber: user.phoneNumber,
      eventType: SMS_EVENTS.PAYMENT_FAILED,
      eventData: { amount, currency },
      userId: user._id
    });

    console.log(`✅ Payment failed SMS sent to ${user.phoneNumber}`);
  } catch (error) {
    console.error('❌ Error sending payment failed SMS:', error);
  }
};

/**
 * Get user by ID or phone number
 * Helper function to fetch user details
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User object
 */
export const getUserForSMS = async (userId) => {
  try {
    const user = await User.findById(userId).select('name firstName phoneNumber email');
    return user;
  } catch (error) {
    console.error('❌ Error fetching user for SMS:', error);
    throw error;
  }
};

export default {
  triggerSignupSMS,
  triggerOTPSMS,
  triggerPasswordResetSMS,
  triggerInterviewScheduledSMS,
  triggerReminderSMS,
  triggerComplaintCreatedSMS,
  triggerComplaintAssignedSMS,
  triggerComplaintResolvedSMS,
  triggerStatusUpdateSMS,
  triggerPaymentSuccessSMS,
  triggerPaymentFailedSMS,
  getUserForSMS
};
