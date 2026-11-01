import { listAccounts, accountStatistics, getAccount, mutateAccounts, disconnectAccounts, unionAccounts } from '../services/accountService.js';
import express from 'express';
import { User, getUserModelByRole, findUserByEmail } from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validatePasswordChange } from '../validators/userValidators.js';

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

// All account-management paths share collection-aware lookup and mutation rules.
router.get(['/', '/all'], authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  res.json(await listAccounts(req.query));
}));
router.get('/stats/overview', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  res.json(await accountStatistics());
}));

router.get('/agents/performance', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { timeRange = '30' } = req.query;
  const days = parseInt(timeRange);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const agentPerformance = await User.aggregate([...unionAccounts(),
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
        name: 1,
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

router.get('/agents/:department', authenticate, authorize('admin', 'agent'), asyncHandler(async (req, res) => {
  const result = await listAccounts({ role: 'agent', department: req.params.department, isActive: 'true', limit: 100 });
  res.json(result.users.map(({_id,name,email,department})=>({_id,name,email,department})));
}));
router.post('/create', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { name, firstName, lastName, email, password, role = 'user', department, organization } = req.body;
  const fullName = name || [firstName, lastName].filter(Boolean).join(' ');
  if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.length > 100 || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 72 || !['user','agent','analytics','admin'].includes(role)) return res.status(400).json({ error: 'Valid name, email, role and password of 12–72 characters required' });
  if ((await findUserByEmail(email)).user) return res.status(409).json({ error: 'Email already registered' });
  const Model = getUserModelByRole(role);
  const user = await Model.create({ name: fullName.trim(), email: email.toLowerCase().trim(), username: await Model.generateUsername(email, fullName), password, role, department, organization, isVerified: true });
  res.status(201).json({ message: 'User created successfully', user: user.toJSON() });
}));
router.patch('/bulk/activate', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' });
  const users = await mutateAccounts(req.body.userIds, { isActive: req.body.isActive }, req.user._id);
  disconnectAccounts(req.app.get('io'), users.map(user=>user._id));
  res.json({ message: 'Account access updated', modifiedCount: users.length });
}));
router.patch('/:id/role', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { role, department } = req.body;
  const users = await mutateAccounts([req.params.id], { role, ...(department !== undefined ? { department } : {}) }, req.user._id);
  disconnectAccounts(req.app.get('io'), [req.params.id]);
  res.json({ message: 'User role updated successfully', user: users[0] });
}));
router.get('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { user } = await getAccount(req.params.id);
  res.json(user);
}));
router.patch('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const users = await mutateAccounts([req.params.id], req.body, req.user._id);
  disconnectAccounts(req.app.get('io'), [req.params.id]);
  res.json(users[0]);
}));
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  await mutateAccounts([req.params.id], { isActive: false }, req.user._id);
  disconnectAccounts(req.app.get('io'), [req.params.id]);
  res.json({ message: 'User deactivated successfully' });
}));
export default router;
