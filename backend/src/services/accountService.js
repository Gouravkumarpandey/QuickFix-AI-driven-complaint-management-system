import mongoose from 'mongoose';
import Joi from 'joi';
import { User, AdminUser, AgentUser, AnalyticsUser, getUserModelByRole } from '../models/User.js';
import { Complaint } from '../models/Complaint.js';
export const accountModels = [User, AdminUser, AgentUser, AnalyticsUser];
export const secretProjection = { password: 0, otp: 0, otpExpiry: 0, resetPasswordToken: 0, resetPasswordExpire: 0, tokensValidAfter: 0 };
const mutationSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100), firstName: Joi.string().trim().min(1).max(50), lastName: Joi.string().trim().max(50),
  email: Joi.string().email().lowercase().trim(), role: Joi.string().valid('user','agent','admin','analytics'),
  department: Joi.string().max(100).allow(''), organization: Joi.string().max(100).allow(''), isActive: Joi.boolean().strict()
}).min(1);
const Lock = mongoose.model('AccountMutationLock', new mongoose.Schema({ _id: String, revision: { type: Number, default: 0 } }));
const Audit = mongoose.model('AccountAudit', new mongoose.Schema({ actor: mongoose.Schema.Types.ObjectId, target: mongoose.Schema.Types.ObjectId, changes: Object }, { timestamps: true }));
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const unionAccounts = () => accountModels.slice(1).map(Model => ({ $unionWith: Model.collection.name }));
export function accountListOptions(query = {}) {
  const schema = Joi.object({ page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(10), role: Joi.string().valid('user','agent','admin','analytics'), department: Joi.string().max(100), isActive: Joi.string().valid('true','false'), search: Joi.string().max(100).allow(''), sortBy: Joi.string().valid('createdAt','name','email','role').default('createdAt'), sortOrder: Joi.string().valid('asc','desc').default('desc') });
  const { error: invalid, value } = schema.validate(query);
  if (invalid) throw error(invalid.details[0].message);
  const filter = {};
  for (const key of ['role','department']) if (value[key]) filter[key] = value[key];
  if (value.isActive) filter.isActive = value.isActive === 'true' ? { $ne: false } : false;
  if (value.search) { const escaped = value.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = ['name','email'].map(key => ({ [key]: { $regex: escaped, $options: 'i' } })); }
  return { ...value, filter };
}
export async function listAccounts(query) {
  const { page, limit, filter, sortBy, sortOrder } = accountListOptions(query);
  const [result] = await User.aggregate([...unionAccounts(), { $match: filter }, { $project: secretProjection }, { $facet: {
    users: [{ $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: 1 } }, { $skip: (page-1)*limit }, { $limit: limit }], count: [{ $count: 'total' }]
  } }]);
  const total = result?.count[0]?.total || 0;
  return { users: result?.users || [], pagination: { current: page, pages: Math.ceil(total/limit), total } };
}
export async function accountStatistics() {
  const [result] = await User.aggregate([...unionAccounts(), { $facet: {
    roles: [{ $group: { _id: '$role', count: { $sum: 1 } } }],
    active: [{ $match: { isActive: { $ne: false } } }, { $count: 'count' }],
    recent: [{ $match: { createdAt: { $gte: new Date(Date.now()-30*86400000) } } }, { $count: 'count' }]
  } }]);
  const roles = Object.fromEntries((result?.roles || []).map(item => [item._id,item.count]));
  const totalUsers = Object.values(roles).reduce((a,b)=>a+b,0), activeUsers = result?.active[0]?.count || 0;
  return { totalUsers, activeUsers, inactiveUsers: totalUsers-activeUsers, recentUsers: result?.recent[0]?.count || 0, roleBreakdown: { users: roles.user || 0, agents: roles.agent || 0, admins: roles.admin || 0, analytics: roles.analytics || 0 } };
}
export async function getAccount(id, session) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) throw error('Invalid account ID');
  for (const Model of accountModels) { const user = await Model.findById(id).session(session || null); if (user) return { user, Model }; }
  throw error('Account not found',404);
}
export async function mutateAccounts(ids, input, actor) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !/^[a-f0-9]{24}$/i.test(String(id)))) throw error('Provide 1–100 valid account IDs');
  const { error: invalid, value } = mutationSchema.validate(input);
  if (invalid) throw error(invalid.details[0].message);
  if (value.email && ids.length !== 1) throw error('Email can only be changed for one account at a time');
  // A singleton write serializes administrator demotion/deactivation and avoids write skew.
  try { await Lock.updateOne({ _id: 'accounts' }, { $setOnInsert: { revision: 0 } }, { upsert: true }); } catch (failure) { if (failure.code !== 11000) throw failure; }
  const session = await mongoose.startSession();
  let users = [];
  try {
    await session.withTransaction(async () => {
      users = [];
      await Lock.updateOne({ _id: 'accounts' }, { $inc: { revision: 1 } }, { session });
      const { user: operator } = await getAccount(actor, session);
      if (operator.role !== 'admin' || operator.isActive === false) throw error('Administrator access revoked',403);
      const targets = [];
      for (const id of [...new Set(ids)]) targets.push(await getAccount(id, session));
      const removedAdmins = targets.filter(({user}) => user.role === 'admin' && user.isActive !== false && (value.isActive === false || (value.role && value.role !== 'admin'))).length;
      if (removedAdmins) {
        let activeAdmins = 0;
        for (const Model of accountModels) activeAdmins += await Model.countDocuments({ role: 'admin', isActive: { $ne: false } }).session(session);
        if (activeAdmins <= removedAdmins) throw error('Cannot remove the last active administrator',409);
      }
      for (const {user,Model} of targets) {
        if (value.email && value.email !== user.email) {
          for (const Other of accountModels) if (await Other.exists({ email: value.email, _id: { $ne: user._id } }).session(session)) throw error('Email already registered',409);
        }
        const previousRole = user.role;
        if (value.firstName || value.lastName !== undefined) user.name = [value.firstName || user.name.split(' ')[0], value.lastName ?? user.name.split(' ').slice(1).join(' ')].filter(Boolean).join(' ');
        for (const [key,entry] of Object.entries(value)) if (!['firstName','lastName'].includes(key)) user[key] = entry;
        user.tokensValidAfter = Date.now();
        if (user.isActive === false || previousRole !== user.role) {
          user.isOnline = false; user.availability = 'offline';
          await Complaint.updateMany({ assignedTo: user._id, status: { $nin: ['Resolved','Closed'] } }, { $set: { assignedTo: null, status: 'Open' }, $push: { updates: { message: 'Requeued after staff account change', updatedBy: actor, updateType: 'assignment', isInternal: true, createdAt: new Date() } } }, { session, runValidators: true });
        }
        await user.validate();
        const Target = getUserModelByRole(user.role);
        if (Target.collection.name !== Model.collection.name) {
          const record = user.toObject(); record.updatedAt = new Date();
          await Target.collection.insertOne(record, { session });
          await Model.deleteOne({ _id: user._id }, { session });
        } else { await user.save({ session }); }
        await Audit.create([{ actor, target: user._id, changes: value }], { session });
        users.push(user.toJSON());
      }
    });
    return users;
  } catch (failure) {
    if (failure.code === 20) throw error('Account management requires a MongoDB replica set or Atlas cluster',503);
    throw failure;
  } finally { await session.endSession(); }
}
export function disconnectAccounts(io, ids) { for (const id of ids) io?.in(`user:${id}`).disconnectSockets(true); }
