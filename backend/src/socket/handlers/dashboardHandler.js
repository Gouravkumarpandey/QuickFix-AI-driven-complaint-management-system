/**
 * Dashboard Handler - Manages real-time dashboard updates
 */
import { Complaint } from '../../models/Complaint.js';
import { User } from '../../models/User.js';
import { getAgentsWithWorkload } from '../../services/ticketAssignmentService.js';

/**
 * Calculate and broadcast dashboard statistics
 * @param {object} io - Socket.io instance
 */
export const broadcastDashboardStats = async (io) => {
  try {
    // Calculate overall statistics
    const totalComplaints = await Complaint.countDocuments();
    const openComplaints = await Complaint.countDocuments({ 
      status: { $in: ['Open', 'New'] } 
    });
    const inProgressComplaints = await Complaint.countDocuments({ 
      status: 'In Progress' 
    });
    const resolvedComplaints = await Complaint.countDocuments({ 
      status: 'Resolved' 
    });
    const escalatedComplaints = await Complaint.countDocuments({ 
      status: 'Escalated' 
    });
    
    // Get count by priority
    const highPriorityComplaints = await Complaint.countDocuments({ 
      priority: 'High' 
    });
    const mediumPriorityComplaints = await Complaint.countDocuments({ 
      priority: 'Medium' 
    });
    const lowPriorityComplaints = await Complaint.countDocuments({ 
      priority: 'Low' 
    });
    
    // Calculate today's statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const newTodayComplaints = await Complaint.countDocuments({
      createdAt: { $gte: today }
    });
    
    const resolvedTodayComplaints = await Complaint.countDocuments({
      status: 'Resolved',
      'resolution.resolvedAt': { $gte: today },
    });
    
    // Get agent statistics
    const agents = await getAgentsWithWorkload();
    
    // Calculate average resolution time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const resolvedComplaints30Days = await Complaint.find({
      status: 'Resolved',
      createdAt: { $gte: thirtyDaysAgo }
    }).lean();
    
    let totalResolutionTime = 0;
    let resolutionCount = 0;
    
    for (const complaint of resolvedComplaints30Days) {
      const createdAt = new Date(complaint.createdAt);
      const resolvedStatusUpdate = complaint.resolution?.resolvedAt ? { updatedAt: complaint.resolution.resolvedAt } : null;
      
      if (resolvedStatusUpdate) {
        const resolvedAt = new Date(resolvedStatusUpdate.updatedAt);
        const resolutionTime = resolvedAt - createdAt;
        totalResolutionTime += resolutionTime;
        resolutionCount++;
      }
    }
    
    const avgResolutionTimeMs = resolutionCount > 0 
      ? totalResolutionTime / resolutionCount 
      : 0;
    
    // Convert to days
    const avgResolutionTimeDays = avgResolutionTimeMs / (1000 * 60 * 60 * 24);
    
    // Compile dashboard data
    const dashboardData = {
      totalComplaints,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      escalatedComplaints,
      highPriorityComplaints,
      mediumPriorityComplaints,
      lowPriorityComplaints,
      newTodayComplaints,
      resolvedTodayComplaints,
      avgResolutionTimeDays: avgResolutionTimeDays.toFixed(1),
      agentPerformance: agents.map(agent => ({
        id: agent._id,
        name: agent.name,
        currentLoad: agent.workload,
        status: agent.agentStatus,
        totalResolved: agent.totalResolved || 0,
        avgResponseTime: agent.avgResponseTime || 0
      }))
    };
    
    // Broadcast to all admin and agent users
    io.to('admin').to('analytics').emit('dashboard_update', dashboardData);
  } catch (error) {
    console.error('Error broadcasting dashboard stats:', error);
  }
};

/**
 * Initialize the dashboard handler
 * @param {object} io - Socket.io instance
 */
export const initDashboardHandler = (io) => {
  io.on('connection', (socket) => {
    // Only proceed if user is an agent or admin
    if (!['agent', 'admin', 'analytics'].includes(socket.user.role)) {
      return;
    }
    
    // Request dashboard data
    socket.on('request_dashboard_data', async () => {
      try {
        // Only send dashboard data to authorized users
        if (!['agent', 'admin', 'analytics'].includes(socket.user.role)) {
          socket.emit('error', { message: 'Unauthorized to access dashboard data' });
          return;
        }
        
        await broadcastDashboardStats(io);
      } catch (error) {
        console.error('Error requesting dashboard data:', error);
        socket.emit('error', { message: 'Failed to get dashboard data' });
      }
    });

    // Set up periodic dashboard updates (every 5 minutes)
    const intervalMinutes = 5;
    const interval = setInterval(async () => {
      try {
        await broadcastDashboardStats(io);
      } catch (error) {
        console.error('Error in periodic dashboard update:', error);
      }
    }, intervalMinutes * 60 * 1000);

    // Clean up interval on socket disconnect
    socket.on('disconnect', () => {
      clearInterval(interval);
    });
  });
};