import express from 'express';
import {
  sendSingleSMS,
  sendBulkSMSHandler,
  getSMSStatusHandler,
  getUserSMSLogsHandler,
  getUserSMSLogsByIdHandler,
  getSMSStatsHandler,
  getEventTypeStatsHandler,
  getSMSEventTypes,
  testSMSConfiguration
} from '../controllers/smsController.js';
import { authenticateToken } from '../middleware/auth.js';
import { isAdmin } from '../middleware/planAuth.js';

const router = express.Router();

// Public routes (require authentication)
router.post('/send', authenticateToken, isAdmin, sendSingleSMS);
router.post('/send-bulk', authenticateToken, isAdmin, sendBulkSMSHandler);
router.post('/test', authenticateToken, isAdmin, testSMSConfiguration);

// Get SMS status
router.get('/status/:messageSid', authenticateToken, isAdmin, getSMSStatusHandler);

// Get user's own SMS logs
router.get('/logs', authenticateToken, getUserSMSLogsHandler);

// Get available event types
router.get('/events', authenticateToken, getSMSEventTypes);

// Admin routes
router.get('/logs/:userId', authenticateToken, isAdmin, getUserSMSLogsByIdHandler);
router.get('/stats', authenticateToken, isAdmin, getSMSStatsHandler);
router.get('/stats/events', authenticateToken, isAdmin, getEventTypeStatsHandler);

export default router;
