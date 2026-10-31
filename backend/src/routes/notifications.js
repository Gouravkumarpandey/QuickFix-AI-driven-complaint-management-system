import { getNotificationPreferences, patchNotificationPreferences } from '../services/notificationPreferences.js';
import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { Notification } from '../models/Notification.js';

const router = express.Router();

// Get all user notifications with pagination
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, unreadOnly = false } = req.query;
  
  const filter = { user: req.user._id };
  if (unreadOnly === 'true') {
    filter.isRead = false;
  }
  
  // Don't show expired notifications
  filter.$or = [
    { expiresAt: { $gt: new Date() } },
    { expiresAt: null }
  ];
  
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  const notifications = await Notification.find(filter)
    .populate('relatedComplaint', 'complaintId title status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
  
  const total = await Notification.countDocuments(filter);
  const unreadCount = await Notification.getUnreadCount(req.user._id);
  
  res.json({
    notifications,
    pagination: {
      current: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      total,
      hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
      hasPrev: parseInt(page) > 1
    },
    unreadCount
  });
}));

// Get unread count
router.get('/unread-count', authenticate, asyncHandler(async (req, res) => {
  const count = await Notification.getUnreadCount(req.user._id);
  res.json({ count });
}));

// Mark notification as read
router.patch('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    user: req.user._id
  });
  
  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  
  await notification.markAsRead();
  
  const unreadCount = await Notification.getUnreadCount(req.user._id);
  
  res.json({ 
    message: 'Notification marked as read',
    notification,
    unreadCount
  });
}));

// Mark all notifications as read
router.post('/read-all', authenticate, asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { 
      user: req.user._id,
      isRead: false
    },
    {
      $set: {
        isRead: true,
        readAt: new Date(),
        'channels.inApp.read': true,
        'channels.inApp.readAt': new Date()
      }
    }
  );
  
  res.json({ 
    message: 'All notifications marked as read',
    modifiedCount: result.modifiedCount,
    unreadCount: 0
  });
}));

// Mark multiple notifications as read
router.post('/read-multiple', authenticate, asyncHandler(async (req, res) => {
  const { notificationIds } = req.body;
  
  if (!notificationIds || !Array.isArray(notificationIds)) {
    return res.status(400).json({ error: 'notificationIds array is required' });
  }
  
  const result = await Notification.markMultipleAsRead(req.user._id, notificationIds);
  const unreadCount = await Notification.getUnreadCount(req.user._id);
  
  res.json({ 
    message: `${result.modifiedCount} notifications marked as read`,
    modifiedCount: result.modifiedCount,
    unreadCount
  });
}));

// Delete notification
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id
  });
  
  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  
  const unreadCount = await Notification.getUnreadCount(req.user._id);
  
  res.json({ 
    message: 'Notification deleted',
    unreadCount
  });
}));

// Delete all read notifications
router.delete('/clear/read', authenticate, asyncHandler(async (req, res) => {
  const result = await Notification.deleteMany({
    user: req.user._id,
    isRead: true
  });
  
  res.json({ 
    message: 'All read notifications cleared',
    deletedCount: result.deletedCount
  });
}));

// Get notification statistics
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const stats = await Notification.getNotificationStats(req.user._id);
  res.json(stats[0] || { total: 0, unread: 0, readRate: 0 });
}));

// Granular preferences merge partial updates; omitted events retain their saved values.
router.get('/preferences', authenticate, asyncHandler(async (req, res) => {
  res.json(getNotificationPreferences(req.user));
}));
router.patch('/preferences', authenticate, asyncHandler(async (req, res) => {
  patchNotificationPreferences(req.user, req.body);
  await req.user.save();
  res.json({ message: 'Notification preferences updated successfully', preferences: getNotificationPreferences(req.user) });
}));

export default router;
