import Joi from 'joi';
export const notificationEvents = ['complaintAssigned','complaintUpdated','complaintResolved','slaBreaches','escalations','newComments'];
export const notificationDefaults = {
  email: Object.fromEntries(notificationEvents.map(event => [event, true])),
  push: Object.fromEntries(notificationEvents.map(event => [event, event !== 'newComments'])),
  sms: Object.fromEntries(notificationEvents.map(event => [event, ['slaBreaches','escalations'].includes(event)]))
};
const channel = Joi.object(Object.fromEntries(notificationEvents.map(event => [event, Joi.boolean().strict()]))).min(1);
export const preferencePatchSchema = Joi.object({ email: channel, push: channel, sms: channel }).min(1);
export function getNotificationPreferences(user) {
  const stored = user.notificationPreferences?.toObject?.() || user.notificationPreferences || {};
  return Object.fromEntries(Object.entries(notificationDefaults).map(([channel, defaults]) => [channel, { ...defaults, ...stored[channel] }]));
}
export function patchNotificationPreferences(user, input) {
  const { error, value } = preferencePatchSchema.validate(input);
  if (error) throw Object.assign(new Error(error.details[0].message), { statusCode: 400 });
  const current = getNotificationPreferences(user);
  user.notificationPreferences = Object.fromEntries(Object.entries(current).map(([channel, events]) => [channel, { ...events, ...value[channel] }]));
  return user.notificationPreferences;
}
export function notificationAllowed(user, channel, event) {
  const master = { email: 'emailNotifications', sms: 'smsNotifications', push: 'pushNotifications' }[channel];
  return user?.preferences?.[master] !== false && getNotificationPreferences(user)[channel]?.[event] !== false;
}
