import Joi from 'joi';
import { SystemSettings } from '../models/SystemSettings.js';
const schema = Joi.object({
  slaTargets: Joi.object().pattern(Joi.string().valid('Critical','Urgent','High','Medium','Low','urgent','high','medium','low'), Joi.number().min(1).max(168)),
  autoAssignment: Joi.object({ enabled: Joi.boolean(), algorithm: Joi.string().valid('workload_based'), rules: Joi.array().max(30).items(Joi.object({ category: Joi.string().max(100).required(), department: Joi.string().max(100).required() })) }),
  notifications: Joi.object({ emailEnabled: Joi.boolean(), smsEnabled: Joi.boolean(), pushEnabled: Joi.boolean(), escalationThreshold: Joi.number().min(0).max(168) }),
  features: Joi.object().pattern(Joi.string().valid('aiClassification','realTimeUpdates','fileUploads','feedbackRequired'), Joi.boolean()),
  categories: Joi.array().max(50).items(Joi.string().max(100)),
  departments: Joi.array().max(50).items(Joi.string().max(100))
}).min(1);
export async function getSettings(defaults = {}) {
  const stored = await SystemSettings.findById('global').lean();
  return { ...defaults, ...stored?.value };
}
export async function saveSettings(body) {
  const { error, value } = schema.validate(body);
  if (error) throw Object.assign(new Error(error.details[0].message), { statusCode: 400 });
  const fields = Object.fromEntries(Object.entries(value).map(([key, entry]) => [`value.${key}`, entry]));
  const saved = await SystemSettings.findOneAndUpdate({ _id: 'global' }, { $set: fields }, { upsert: true, new: true });
  return saved.value;
}
