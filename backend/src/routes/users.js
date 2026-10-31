import express from 'express';
import { User, getUserModelByRole, findUserByEmail, findUserById } from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateUserUpdate, validatePasswordChange } from '../validators/userValidators.js';

const router = express.Router();

// Get current user profile
router.get('/profile', authenticate, asyncHandler(async (req, res) => {
  res.json({ id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role, phoneNumber: req.user.phoneNumber, organization: req.user.organization, preferences: req.user.preferences, createdAt: req.user.createdAt, planType: req.user.planType });
}));

// Update user profile
router.patch('/profile', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['name','phoneNumber','organization','preferences'];
  if (!Object.keys(req.body).length || Object.keys(req.body).some(key => !allowed.includes(key))) return res.status(400).json({ error: 'Invalid profile fields' });
  if (req.body.name !== undefined && (typeof req.body.name !== 'string' || req.body.name.trim().length < 2 || req.body.name.length > 100)) return res.status(400).json({ error: 'Invalid name' });
  if (req.body.phoneNumber !== undefined && (typeof req.body.phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(req.body.phoneNumber))) return res.status(400).json({ error: 'Phone number must use international format' });
  if (req.body.organization !== undefined && (typeof req.body.organization !== 'string' || req.body.organization.length > 100)) return res.status(400).json({ error: 'Invalid organization' });
  if (req.body.preferences) {
    const allowedPreferences = ['emailNotifications','smsNotifications','pushNotifications','language','timezone'];
    if (typeof req.body.preferences !== 'object' || Array.isArray(req.body.preferences) || Object.entries(req.body.preferences).some(([key,value]) => !allowedPreferences.includes(key) || (key.endsWith('Notifications') ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 100))) return res.status(400).json({ error: 'Invalid preferences' });
    req.user.preferences = { ...req.user.preferences?.toObject?.(), ...req.body.preferences };
  }
  if (req.body.organization !== undefined) req.user.organization = req.body.organization;
  if (req.body.name) req.user.name = req.body.name.trim();
  if (req.body.phoneNumber) req.user.phoneNumber = req.body.phoneNumber;
  await req.user.save();
  res.json(req.user);
}));

// Change password
router.patch('/password', authenticate, asyncHandler(async (req, res) => {
  const { error } = validatePasswordChange(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { currentPassword, newPassword } = req.body;

  const user = req.user;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Verify current password
  const isCurrentPasswordValid = await user.matchPassword(currentPassword);
  if (!isCurrentPasswordValid) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  user.password = newPassword;
  user.tokensValidAfter = Date.now();
  req.app.get('io')?.in(`user:${user._id}`).disconnectSockets(true);
  await user.save();

  res.json({ message: 'Password updated successfully' });
}));

// Get all users (admin only)
router.get('/', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const {
    role,
    department,
    isActive,
    page = 1,
    limit = 10,
    search
  } = req.query;

  // Build filter object
  const filter = {};
  if (role) filter.role = role;
  if (department) filter.department = department;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  // Add search functionality
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const users = await User.find(filter)
    .select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpire -tokensValidAfter')
    .sort({ createdAt: -1 })
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

// Get user by ID (admin only)
router.get('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpire -tokensValidAfter');
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
}));

// Update user (admin only)
router.patch('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { error } = validateUserUpdate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const allowedUpdates = ['firstName', 'lastName', 'email', 'role', 'department', 'isActive', 'profile', 'preferences'];
  const updates = Object.keys(req.body);
  const isValidOperation = updates.every(update => allowedUpdates.includes(update));

  if (!isValidOperation) {
    return res.status(400).json({ error: 'Invalid updates' });
  }

  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    updates.forEach(update => {
      if (update === 'profile' || update === 'preferences') {
        user[update] = { ...user[update], ...req.body[update] };
      } else {
        user[update] = req.body[update];
      }
    });

    await user.save();
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

// Delete user (admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Don't allow deletion of the last admin
  if (user.role === 'admin') {
    const adminCount = await User.countDocuments({ role: 'admin', isActive: true });
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }
  }

  // Soft delete by setting isActive to false
  user.isActive = false;
  await user.save();

  res.json({ message: 'User deactivated successfully' });
}));

// Get agents by department (admin only)
router.get('/agents/:department', authenticate, authorize('admin', 'agent'), asyncHandler(async (req, res) => {
  const { department } = req.params;
  
  const agents = await User.find({
    role: 'agent',
    department,
    isActive: true
  }).select('firstName lastName email department');

  res.json(agents);
}));

// Get all users with pagination and filtering (admin only)
router.get('/all', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    role, 
    isActive, 
    department,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build filter object
  const filter = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (department) filter.department = department;
  
  // Search functionality
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build sort object
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

// Create new user (admin only)
router.post('/create', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { name, firstName, lastName, email, password, role = 'user', department, organization } = req.body;
  const fullName = name || [firstName, lastName].filter(Boolean).join(' ');
  if (!fullName || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || !['user','agent','analytics','admin'].includes(role)) return res.status(400).json({ error: 'Valid name, email, role and password of at least 12 characters required' });
  if ((await findUserByEmail(email)).user) return res.status(409).json({ error: 'Email already registered' });
  const Model = getUserModelByRole(role);
  const user = await Model.create({ name: fullName, email: email.toLowerCase().trim(), username: await Model.generateUsername(email, fullName), password, role, department, organization, isVerified: true });
  res.status(201).json({ message: 'User created successfully', user: { id: user._id, name: user.name, email: user.email, role: user.role } });
}));

// Bulk user operations (admin only)
router.patch('/bulk/activate', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { userIds, isActive } = req.body;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'Please provide user IDs' });
  }

  const result = await User.updateMany(
    { _id: { $in: userIds } },
    { isActive: isActive !== false, updatedAt: new Date() }
  );

  res.json({
    message: `${result.modifiedCount} users ${isActive !== false ? 'activated' : 'deactivated'} successfully`,
    modifiedCount: result.modifiedCount
  });
}));

// Update user role (admin only)
router.patch('/:id/role', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { role, department } = req.body;

  if (!['user', 'agent', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.role = role;
  if (department) user.department = department;
  user.updatedAt = new Date();

  await user.save();

  const userResponse = user.toObject();
  delete userResponse.password;

  res.json({
    message: 'User role updated successfully',
    user: userResponse
  });
}));

// Get user statistics (admin only)
router.get('/stats/overview', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const [
    totalUsers,
    activeUsers,
    usersByRole,
    recentUsers
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]),
    User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    })
  ]);

  const roleStats = usersByRole.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  res.json({
    totalUsers,
    activeUsers,
    inactiveUsers: totalUsers - activeUsers,
    recentUsers,
    roleBreakdown: {
      users: roleStats.user || 0,
      agents: roleStats.agent || 0,
      admins: roleStats.admin || 0
    }
  });
}));

// Get agent performance metrics (admin only)
router.get('/agents/performance', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { timeRange = '30' } = req.query;
  const days = parseInt(timeRange);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const agentPerformance = await User.aggregate([
    { $match: { role: 'agent', isActive: true } },
    {
      $lookup: {
        from: 'complaints',
        let: { agentId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$assignedTo', '$$agentId'] },
              createdAt: { $gte: startDate }
            }
          }
        ],
        as: 'assignedComplaints'
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
              status: { $in: ['Resolved', 'Closed'] },
              createdAt: { $gte: startDate }
            }
          }
        ],
        as: 'resolvedComplaints'
      }
    },
    {
      $project: {
        firstName: 1,
        lastName: 1,
        email: 1,
        department: 1,
        totalAssigned: { $size: '$assignedComplaints' },
        totalResolved: { $size: '$resolvedComplaints' },
        resolutionRate: {
          $cond: [
            { $eq: [{ $size: '$assignedComplaints' }, 0] },
            0,
            {
              $multiply: [
                { $divide: [{ $size: '$resolvedComplaints' }, { $size: '$assignedComplaints' }] },
                100
              ]
            }
          ]
        }
      }
    },
    { $sort: { resolutionRate: -1, totalResolved: -1 } }
  ]);

  res.json(agentPerformance);
}));

export default router;
