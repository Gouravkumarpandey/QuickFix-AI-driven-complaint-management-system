import { emitComplaintEvent } from '../../services/complaintEvents.js';
/**
 * Chat Handler - Manages real-time chat messaging for complaints
 */
import { Complaint } from '../../models/Complaint.js';
import { sendNotification } from './notificationHandler.js';
import { createNotification } from '../../services/notificationService.js';

/**
 * Initialize the chat handler
 * @param {object} io - Socket.io instance
 */
export const initChatHandler = (io) => {
  io.on('connection', (socket) => {
    // Join chat room for a specific complaint
    socket.on('join_chat', async ({ complaintId }) => {
      try {
        // Security check - ensure user can access this complaint's chat
        const complaint = await Complaint.findById(complaintId);
        
        if (!complaint) {
          socket.emit('error', { message: 'Complaint not found' });
          return;
        }
        
        // Users can only access chats for their own complaints unless they're agents or admins
        const isOwner = complaint.user?.toString() === socket.user._id.toString();
        const isAssignedAgent = complaint.assignedTo?.toString() === socket.user._id.toString();
        const isAdmin = socket.user.role === 'admin';
        
        if (!isOwner && !isAssignedAgent && !isAdmin) {
          socket.emit('error', { message: 'Unauthorized to access this chat' });
          return;
        }
        
        // Join the chat room
        const roomName = `chat:${complaintId}`;
        socket.join(roomName);
        console.log(`User ${socket.user._id} joined chat room ${roomName}`);
        
        socket.emit('joined_chat', { complaintId, roomName });
      } catch (error) {
        console.error('Error joining chat room:', error);
        socket.emit('error', { message: 'Failed to join chat room' });
      }
    });
    
    // Leave chat room
    socket.on('leave_chat', ({ complaintId }) => {
      const roomName = `chat:${complaintId}`;
      socket.leave(roomName);
      console.log(`User ${socket.user._id} left chat room ${roomName}`);
      socket.emit('left_chat', { complaintId });
    });
    
    // Send message in chat
    socket.on('send_message', async ({ complaintId, message }) => {
      try {
        const complaint = await Complaint.findById(complaintId);
        
        if (!complaint) {
          socket.emit('error', { message: 'Complaint not found' });
          return;
        }
        
        // Security check - only owner, assigned agent, or admin can send messages
        const isOwner = complaint.user?.toString() === socket.user._id.toString();
        const isAssignedAgent = complaint.assignedTo?.toString() === socket.user._id.toString();
        const isAdmin = socket.user.role === 'admin';
        
        if (!isOwner && !isAssignedAgent && !isAdmin) {
          socket.emit('error', { message: 'Unauthorized to send messages in this chat' });
          return;
        }
        
        if (typeof message !== 'string' || !message.trim() || message.length > 2000) { socket.emit('error', { message: 'Message must contain 1–2000 characters' }); return; }
        // Create message object
        const chatMessage = {
          sender: socket.user._id,
          senderName: socket.user.name || `${socket.user.firstName} ${socket.user.lastName}`,
          senderRole: socket.user.role,
          text: message,
          timestamp: new Date()
        };
        
        // Add message to complaint's messages array
        complaint.messages.push(chatMessage);
        await complaint.save();
        
        // Broadcast message to all users in the chat room
        const roomName = `chat:${complaintId}`;
        emitComplaintEvent(io, complaint, 'new_message', {
          complaintId,
          message: chatMessage
        });
        
        // Create notification for the other party
        let recipientId;
        
        if (isOwner) {
          // If sender is the complaint owner, notify the assigned agent
          recipientId = complaint.assignedTo;
        } else {
          // If sender is an agent or admin, notify the complaint owner
          recipientId = complaint.user;
        }
        
        // Only send notification if recipient exists and isn't the sender
        if (recipientId && recipientId.toString() !== socket.user._id.toString()) {
          await createNotification({ userId: recipientId, title: 'New message', message: `New message in complaint #${complaint.complaintId}`, type: 'new_message', complaintId });
        }
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Mark messages as read
    socket.on('mark_messages_read', async ({ complaintId }) => {
      try {
        const complaint = await Complaint.findById(complaintId);
        
        if (!complaint) {
          socket.emit('error', { message: 'Complaint not found' });
          return;
        }
        
        // Security check - only owner, assigned agent, or admin can mark messages as read
        const isOwner = complaint.user?.toString() === socket.user._id.toString();
        const isAssignedAgent = complaint.assignedTo?.toString() === socket.user._id.toString();
        const isAdmin = socket.user.role === 'admin';
        
        if (!isOwner && !isAssignedAgent && !isAdmin) {
          socket.emit('error', { message: 'Unauthorized to mark messages as read' });
          return;
        }
        
        // Update lastRead timestamp based on user role
        if (isOwner) {
          complaint.lastReadByUser = new Date();
        } else {
          complaint.lastReadByAgent = new Date();
        }
        
        await complaint.save();
        
        // Emit event to confirm messages marked as read
        socket.emit('messages_marked_read', {
          complaintId,
          lastRead: isOwner ? complaint.lastReadByUser : complaint.lastReadByAgent
        });
      } catch (error) {
        console.error('Error marking messages as read:', error);
        socket.emit('error', { message: 'Failed to mark messages as read' });
      }
    });
  });
};