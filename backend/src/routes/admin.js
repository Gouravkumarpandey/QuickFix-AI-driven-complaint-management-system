import { getSettings, saveSettings } from '../services/settingsService.js';
import { toCSV } from '../utils/csv.js';
import express from 'express';
import { Complaint } from '../models/Complaint.js';
import { User, AgentUser } from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get system statistics
router.get('/stats', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  try {
    // Get user counts from all collections
    const [usersCount, adminsCount, agentsCount, analyticsCount] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'agent' }),
      User.countDocuments({ role: 'analytics' })
    ]);
    
    // Total users across all roles
    const totalUsers = usersCount + adminsCount + agentsCount + analyticsCount;
    
    // Active agents (agents who are online or available)
    const activeAgents = await User.countDocuments({ 
      role: 'agent', 
      $or: [
        { agentStatus: 'available' },
        { agentStatus: 'busy' },
        { isOnline: true }
      ]
    });
    
    // Complaint statistics
    const [
      totalComplaints,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      closedComplaints,
      escalatedComplaints,
      highPriorityComplaints,
      urgentComplaints
    ] = await Promise.all([
      Complaint.countDocuments(),
      Complaint.countDocuments({ status: 'Open' }),
      Complaint.countDocuments({ status: 'In Progress' }),
      Complaint.countDocuments({ status: 'Resolved' }),
      Complaint.countDocuments({ status: 'Closed' }),
      Complaint.countDocuments({ status: 'Escalated' }),
      Complaint.countDocuments({ priority: 'High' }),
      Complaint.countDocuments({ priority: 'Urgent' })
    ]);

    // Calculate pending (Open + In Progress)
    const pendingComplaints = openComplaints + inProgressComplaints;
    
    // Calculate critical (High + Urgent priority)
    const criticalComplaints = highPriorityComplaints + urgentComplaints;

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newToday = await Complaint.countDocuments({ 
      createdAt: { $gte: today } 
    });
    const resolvedToday = await Complaint.countDocuments({ 
      status: { $in: ['Resolved', 'Closed'] },
      updatedAt: { $gte: today }
    });

    res.json({
      // User stats
      totalUsers,
      usersCount,
      adminsCount,
      agentsCount: agentsCount,
      analyticsCount,
      activeAgents: activeAgents || agentsCount, // fallback to total agents if no active status
      
      // Complaint stats
      totalComplaints,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      closedComplaints,
      pendingComplaints,
      escalatedComplaints,
      criticalComplaints,
      highPriorityComplaints,
      urgentComplaints,
      
      // Today's stats
      newToday,
      resolvedToday,
      
      // Summary for quick access
      summary: {
        users: totalUsers,
        agents: activeAgents || agentsCount,
        total: totalComplaints,
        resolved: resolvedComplaints + closedComplaints,
        pending: pendingComplaints,
        critical: criticalComplaints
      }
    });
  } catch (error) {
    console.error('Error fetching system statistics:', error);
    res.status(500).json({ error: 'Failed to fetch system statistics' });
  }
}));

// Get agent performance and workload data
router.get('/agents/performance', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  try {
    // Get all agents from both User collection (with role: 'agent') and AgentUser collection
    const [usersAsAgents, agentUsers] = await Promise.all([
      User.find({ role: 'agent' }).select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpire -tokensValidAfter').lean(),
      AgentUser.find({}).select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpire -tokensValidAfter').lean()
    ]);
    
    // Combine and deduplicate agents by email
    const agentMap = new Map();
    [...usersAsAgents, ...agentUsers].forEach(agent => {
      if (!agentMap.has(agent.email)) {
        agentMap.set(agent.email, agent);
      }
    });
    const allAgents = Array.from(agentMap.values());
    
    // Get complaint statistics for each agent
    const agentPerformance = await Promise.all(allAgents.map(async (agent) => {
      const agentId = agent._id;
      
      // Get all complaints assigned to this agent
      const [
        totalTickets,
        resolvedTickets,
        openTickets,
        inProgressTickets,
        closedTickets
      ] = await Promise.all([
        Complaint.countDocuments({ assignedTo: agentId }),
        Complaint.countDocuments({ assignedTo: agentId, status: 'Resolved' }),
        Complaint.countDocuments({ assignedTo: agentId, status: 'Open' }),
        Complaint.countDocuments({ assignedTo: agentId, status: 'In Progress' }),
        Complaint.countDocuments({ assignedTo: agentId, status: 'Closed' })
      ]);
      
      // Calculate average resolution time for resolved complaints
      const resolvedComplaints = await Complaint.find({
        assignedTo: agentId,
        status: { $in: ['Resolved', 'Closed'] }
      }).select('createdAt updatedAt').lean();
      
      let avgResolutionTime = 0;
      if (resolvedComplaints.length > 0) {
        const totalTime = resolvedComplaints.reduce((sum, complaint) => {
          const created = new Date(complaint.createdAt);
          const resolved = new Date(complaint.updatedAt);
          return sum + (resolved - created);
        }, 0);
        avgResolutionTime = totalTime / resolvedComplaints.length;
      }
      
      // Format average resolution time
      const avgTimeHours = Math.round(avgResolutionTime / (1000 * 60 * 60));
      let avgTimeFormatted;
      if (avgTimeHours < 24) {
        avgTimeFormatted = `${avgTimeHours}h`;
      } else {
        const days = Math.floor(avgTimeHours / 24);
        const hours = avgTimeHours % 24;
        avgTimeFormatted = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
      }
      
      // Calculate resolution rate (rating simulation based on resolution percentage)
      const resolutionRate = totalTickets > 0 
        ? ((resolvedTickets + closedTickets) / totalTickets * 100).toFixed(1)
        : 0;
      
      // Simulate rating based on resolution rate and response time
      let rating = 4.0;
      if (resolutionRate >= 90) rating = 4.9;
      else if (resolutionRate >= 80) rating = 4.7;
      else if (resolutionRate >= 70) rating = 4.5;
      else if (resolutionRate >= 60) rating = 4.2;
      else if (resolutionRate >= 50) rating = 4.0;
      else if (resolutionRate >= 40) rating = 3.8;
      else rating = 3.5;
      
      // Determine status based on availability or online status
      let status = 'offline';
      if (agent.availability === 'available' || agent.isOnline) {
        status = 'online';
      } else if (agent.availability === 'busy') {
        status = 'busy';
      }
      
      return {
        _id: agent._id,
        name: agent.name || 'Unknown Agent',
        email: agent.email,
        phone: agent.phoneNumber || '',
        department: agent.department || 'General',
        organization: agent.organization || '',
        status: status,
        availability: agent.availability || 'offline',
        joinDate: agent.createdAt,
        stats: {
          totalTickets,
          resolvedTickets,
          openTickets,
          inProgressTickets,
          closedTickets,
          pendingTickets: openTickets + inProgressTickets,
          resolutionRate: parseFloat(resolutionRate),
          rating: rating,
          avgResolutionTime: avgTimeFormatted
        }
      };
    }));
    
    // Sort by total tickets (most active first)
    agentPerformance.sort((a, b) => b.stats.totalTickets - a.stats.totalTickets);
    
    res.json({
      agents: agentPerformance,
      total: agentPerformance.length,
      summary: {
        totalAgents: agentPerformance.length,
        onlineAgents: agentPerformance.filter(a => a.status === 'online').length,
        busyAgents: agentPerformance.filter(a => a.status === 'busy').length,
        offlineAgents: agentPerformance.filter(a => a.status === 'offline').length,
        totalTicketsAssigned: agentPerformance.reduce((sum, a) => sum + a.stats.totalTickets, 0),
        totalTicketsResolved: agentPerformance.reduce((sum, a) => sum + a.stats.resolvedTickets, 0)
      }
    });
  } catch (error) {
    console.error('Error fetching agent performance:', error);
    res.status(500).json({ error: 'Failed to fetch agent performance data' });
  }
}));

// Get all users with enhanced filtering
router.get('/users', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const {
    role,
    department,
    isActive,
    page = 1,
    limit = 10,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  const filter = {};
  if (role) filter.role = role;
  if (department) filter.department = department;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const users = await User.find(filter)
    .select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpire -tokensValidAfter')
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit));

  const total = await User.countDocuments(filter);

  res.json({
    users,
    pagination: {
      current: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      total
    }
  });
}));

// Bulk update users
router.patch('/users/bulk', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { userIds, updates } = req.body;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'User IDs array is required' });
  }

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Updates object is required' });
  }

  try {
    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { $set: updates }
    );

    res.json({
      message: `${result.modifiedCount} users updated successfully`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

// Get all complaints with admin-level access
router.get('/complaints', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const {
    status,
    category,
    priority,
    assignedTo,
    isEscalated,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    dateFrom,
    dateTo
  } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  if (assignedTo) filter.assignedTo = assignedTo;
  if (isEscalated !== undefined) filter.isEscalated = isEscalated === 'true';

  // Date range filter
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const complaints = await Complaint.find(filter)
    .populate('user', 'name email')
    .populate('assignedTo', 'firstName lastName email department')
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Complaint.countDocuments(filter);

  res.json({
    complaints,
    pagination: {
      current: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      total
    }
  });
}));

// Bulk assign complaints
router.patch('/complaints/bulk-assign', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { complaintIds, agentId, teamName } = req.body;

  if (!complaintIds || !Array.isArray(complaintIds) || complaintIds.length === 0) {
    return res.status(400).json({ error: 'Complaint IDs array is required' });
  }

  if (!agentId) {
    return res.status(400).json({ error: 'Agent ID is required' });
  }

  try {
    const agent = await AgentUser.findById(agentId);
    if (!agent || agent.role !== 'agent') {
      return res.status(400).json({ error: 'Invalid agent ID' });
    }

    const updateData = {
      assignedTo: agentId,
      assignedTeam: teamName || agent.department,
      status: 'In Progress',
      updatedAt: new Date()
    };

    const result = await Complaint.updateMany(
      { _id: { $in: complaintIds } },
      { $set: updateData }
    );

    res.json({
      message: `${result.modifiedCount} complaints assigned successfully`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

// Close multiple complaints
router.patch('/complaints/bulk-close', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { complaintIds, reason } = req.body;

  if (!complaintIds || !Array.isArray(complaintIds) || complaintIds.length === 0) {
    return res.status(400).json({ error: 'Complaint IDs array is required' });
  }

  try {
    const result = await Complaint.updateMany(
      { _id: { $in: complaintIds } },
      {
        $set: {
          status: 'Closed',
          updatedAt: new Date()
        },
        $push: {
          updates: {
            message: reason || 'Complaint closed by administrator',
            updatedBy: req.user._id,
            timestamp: new Date(),
            updateType: 'status_change',
            isInternal: false
          }
        }
      }
    );

    res.json({
      message: `${result.modifiedCount} complaints closed successfully`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

// Get system configuration
router.get('/config', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  // Return system configuration that can be modified
  const config = {
    slaTargets: {
      Urgent: 4, // hours
      High: 24,
      Medium: 48,
      Low: 72
    },
    autoAssignment: {
      enabled: true,
      rules: [
        { category: 'Billing', department: 'Billing Team' },
        { category: 'Technical', department: 'Tech Support Team' },
        { category: 'Service', department: 'Customer Service Team' },
        { category: 'Product', department: 'Product Team' },
        { category: 'General', department: 'General Support Team' }
      ]
    },
    notifications: {
      emailEnabled: true,
      smsEnabled: false,
      escalationThreshold: 2 // hours past SLA
    },
    features: {
      aiClassification: true,
      realTimeUpdates: true,
      fileUploads: true,
      feedbackRequired: true
    }
  };

  res.json(await getSettings(config));
}));

// Update system configuration
router.patch('/config', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  // In a real application, you would save this to a configuration collection
  // For now, we'll just validate and return the updated configuration
  const { slaTargets, autoAssignment, notifications, features } = req.body;

  // Basic validation
  if (slaTargets) {
    const validPriorities = ['Urgent', 'High', 'Medium', 'Low'];
    for (const priority of validPriorities) {
      if (slaTargets[priority] && (slaTargets[priority] < 1 || slaTargets[priority] > 168)) {
        return res.status(400).json({ error: `Invalid SLA target for ${priority} priority` });
      }
    }
  }

  const config = await saveSettings(req.body);
  res.json({ message: 'Configuration updated successfully', config });
}));

// Export data
router.get('/export/:type', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { format = 'json', dateFrom, dateTo } = req.query;

  if (!['complaints', 'users'].includes(type)) {
    return res.status(400).json({ error: 'Invalid export type' });
  }

  if (!['json', 'csv'].includes(format)) {
    return res.status(400).json({ error: 'Invalid export format' });
  }

  try {
    let data;
    const filter = {};

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    if (type === 'complaints') {
      data = await Complaint.find(filter)
        .populate('user', 'name email')
        .populate('assignedTo', 'firstName lastName email')
        .lean();
    } else {
      data = await User.find(filter).select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpire -tokensValidAfter').lean();
    }

    if (format === 'csv') {
      // In a real application, you would use a CSV library to format the data
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${type}-export.csv`);
      res.send(toCSV(data, type === 'complaints' ? ['complaintId', 'title', 'category', 'priority', 'status', 'createdAt'] : ['name', 'email', 'role', 'createdAt']));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${type}-export.json`);
      res.json(data);
    }
  } catch (error) {
    res.status(500).json({ error: 'Export failed' });
  }
}));

// System settings management
router.get('/settings', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  // In a real app, these would come from a settings collection
  const systemSettings = {
    slaTargets: {
      urgent: 4,
      high: 24,
      medium: 48,
      low: 72
    },
    autoAssignment: {
      enabled: true,
      algorithm: 'workload_based'
    },
    categories: [
      'Technical Issue',
      'Billing',
      'Account Management',
      'Product Support',
      'General Inquiry',
      'Feature Request',
      'Bug Report'
    ],
    departments: [
      'Technical Support',
      'Customer Service',
      'Billing',
      'Sales',
      'Management'
    ],
    notifications: {
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: true
    }
  };

  res.json(await getSettings(systemSettings));
}));

// Update system settings
router.patch('/settings', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { slaTargets, autoAssignment, categories, departments, notifications } = req.body;

  const settings = await saveSettings(req.body);
  res.json({ message: 'System settings updated successfully', settings });
}));

// Advanced analytics for admin dashboard
router.get('/analytics/advanced', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { timeRange = '30' } = req.query;
  const days = parseInt(timeRange);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    // System performance metrics
    const [
      totalComplaints,
      resolvedComplaints,
      escalatedComplaints,
      overdueComplaints,
      avgResolutionTime,
      categoryDistribution,
      priorityDistribution,
      dailyVolume
    ] = await Promise.all([
      Complaint.countDocuments({ createdAt: { $gte: startDate } }),
      Complaint.countDocuments({ 
        createdAt: { $gte: startDate },
        status: { $in: ['Resolved', 'Closed'] }
      }),
      Complaint.countDocuments({ 
        createdAt: { $gte: startDate },
        isEscalated: true 
      }),
      Complaint.countDocuments({
        createdAt: { $gte: startDate },
        status: { $nin: ['Resolved', 'Closed'] },
        slaTarget: { $lt: new Date() }
      }),
      // Average resolution time
      Complaint.aggregate([
        { 
          $match: { 
            createdAt: { $gte: startDate },
            status: { $in: ['Resolved', 'Closed'] },
            'metrics.resolutionTime': { $exists: true }
          }
        },
        {
          $group: {
            _id: null,
            avgTime: { $avg: '$metrics.resolutionTime' }
          }
        }
      ]),
      // Category distribution
      Complaint.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      // Priority distribution
      Complaint.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      // Daily volume trends
      Complaint.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
            resolved: {
              $sum: { $cond: [{ $in: ['$status', ['Resolved', 'Closed']] }, 1, 0] }
            }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // Calculate additional metrics
    const resolutionRate = totalComplaints > 0 ? (resolvedComplaints / totalComplaints * 100) : 0;
    const escalationRate = totalComplaints > 0 ? (escalatedComplaints / totalComplaints * 100) : 0;
    const slaCompliance = totalComplaints > 0 ? ((totalComplaints - overdueComplaints) / totalComplaints * 100) : 100;

    res.json({
      overview: {
        totalComplaints,
        resolvedComplaints,
        escalatedComplaints,
        overdueComplaints,
        resolutionRate: Math.round(resolutionRate * 10) / 10,
        escalationRate: Math.round(escalationRate * 10) / 10,
        slaCompliance: Math.round(slaCompliance * 10) / 10,
        avgResolutionTime: avgResolutionTime[0]?.avgTime || 0
      },
      distributions: {
        byCategory: categoryDistribution,
        byPriority: priorityDistribution
      },
      trends: {
        daily: dailyVolume
      },
      timeRange: days
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch advanced analytics' });
  }
}));

// Agent workload management
router.get('/agents/workload', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  try {
    const agentWorkloads = await User.aggregate([
      { $match: { role: 'agent', isActive: true } },
      {
        $lookup: {
          from: 'complaints',
          let: { agentId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$assignedTo', '$$agentId'] },
                status: { $nin: ['Resolved', 'Closed'] }
              }
            }
          ],
          as: 'activeComplaints'
        }
      },
      {
        $lookup: {
          from: 'complaints',
          let: { agentId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$assignedTo', '$$agentId'] },
                status: { $nin: ['Resolved', 'Closed'] },
                priority: 'Urgent'
              }
            }
          ],
          as: 'urgentComplaints'
        }
      },
      {
        $lookup: {
          from: 'complaints',
          let: { agentId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$assignedTo', '$$agentId'] },
                status: { $nin: ['Resolved', 'Closed'] },
                slaTarget: { $lt: new Date() }
              }
            }
          ],
          as: 'overdueComplaints'
        }
      },
      {
        $project: {
          firstName: 1,
          lastName: 1,
          email: 1,
          department: 1,
          activeCount: { $size: '$activeComplaints' },
          urgentCount: { $size: '$urgentComplaints' },
          overdueCount: { $size: '$overdueComplaints' },
          workloadScore: {
            $add: [
              { $size: '$activeComplaints' },
              { $multiply: [{ $size: '$urgentComplaints' }, 2] },
              { $multiply: [{ $size: '$overdueComplaints' }, 1.5] }
            ]
          }
        }
      },
      { $sort: { workloadScore: -1 } }
    ]);

    res.json(agentWorkloads);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agent workloads' });
  }
}));

// System health check
router.get('/health', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  try {
    // Check database connectivity and basic metrics
    const dbStats = await Promise.all([
      User.countDocuments(),
      Complaint.countDocuments(),
      Complaint.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } })
    ]);

    const systemHealth = {
      status: 'healthy',
      timestamp: new Date(),
      database: {
        connected: true,
        totalUsers: dbStats[0],
        totalComplaints: dbStats[1],
        complaintsLast24h: dbStats[2]
      },
      performance: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };

    res.json(systemHealth);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date()
    });
  }
}));

// Bulk category/priority management
router.post('/complaints/bulk-update-category', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { oldCategory, newCategory } = req.body;

  if (!oldCategory || !newCategory) {
    return res.status(400).json({ error: 'Both old and new category are required' });
  }

  try {
    const result = await Complaint.updateMany(
      { category: oldCategory },
      { 
        category: newCategory,
        updatedAt: new Date()
      }
    );

    res.json({
      message: `Successfully updated ${result.modifiedCount} complaints`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update categories' });
  }
}));

export default router;
