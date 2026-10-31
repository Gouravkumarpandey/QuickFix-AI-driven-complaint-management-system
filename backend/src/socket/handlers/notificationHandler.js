/**
 * Notification Handler - Manages sending, receiving, and marking notifications
 */
import { Notification } from '../../models/Notification.js';
import { createNotification, createNotifications } from '../../services/notificationService.js';
import { getConnectedUsers } from './connectionHandler.js';

/**
 * Send notification to specific users or broadcast to all users with specific role
 * @param {object} io - Socket.io instance
 * @param {object} notification - The notification object
 * @param {string|Array} targets - User ID(s) or role(s) to target
 */
export const sendNotification = (io, notification, targets) => {
  const connectedUsers = getConnectedUsers();
  
  if (Array.isArray(targets)) {
    // Send to specific users
    targets.forEach(userId => {
      const userConnection = connectedUsers.get(userId);
      if (userConnection) {
        io.to(userConnection.socketId).emit('notification', { notification });
      }
    });
  } else if (typeof targets === 'string') {
    // Send to all users with specific role
    for (const [userId, conn] of connectedUsers.entries()) {
      if (conn.role === targets) {
        io.to(conn.socketId).emit('notification', { notification });
      }
    }
  } else {
    // Broadcast to everyone
    io.to(`user:${notification.user}`).emit('notification', { notification });
  }
};

/**
 * Initialize the notification handler
 * @param {object} io - Socket.io instance
 */
export const initNotificationHandler = (io) => {
  io.on('connection', (socket) => {
    // Mark notifications as read
    socket.on('mark_notification_read', async ({ notificationId }) => {
      try {
        const notification = await Notification.findById(notificationId);
        
        if (!notification) {
          socket.emit('error', { message: 'Notification not found' });
          return;
        }
        
        // Security check - ensure user can only mark their own notifications as read
        if (notification.user.toString() !== socket.user._id.toString()) {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }
        
        notification.isRead = true;
        await notification.save();
        
        socket.emit('notification_marked_read', { notificationId });
      } catch (error) {
        console.error('Error marking notification as read:', error);
        socket.emit('error', { message: 'Failed to mark notification as read' });
      }
    });
    
    // Mark all notifications as read for a user
    socket.on('mark_all_notifications_read', async () => {
      try {
        const userId = socket.user._id;
        
        await Notification.updateMany(
          { user: userId, isRead: false },
          { isRead: true }
        );
        
        socket.emit('all_notifications_marked_read');
      } catch (error) {
        console.error('Error marking all notifications as read:', error);
        socket.emit('error', { message: 'Failed to mark all notifications as read' });
      }
    });

    // Get all notifications for current user
    socket.on('get_notifications', async ({ page = 1, limit = 20 }) => {
      try {
        const userId = socket.user._id;
        
        const notifications = await Notification.find({ user: userId })
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit);
        
        const totalCount = await Notification.countDocuments({ user: userId });
        const unreadCount = await Notification.countDocuments({ 
          user: userId,
          isRead: false 
        });
        
        socket.emit('notifications', {
          notifications,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            unreadCount
          }
        });
      } catch (error) {
        console.error('Error fetching notifications:', error);
        socket.emit('error', { message: 'Failed to fetch notifications' });
      }
    });
  });
};