import { Complaint } from '../models/Complaint.js';
export const statuses = ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed', 'Escalated'];
const id = value => String(value?._id || value || '');
export function canAccessComplaint(user, complaint) {
  return user.role === 'admin' || (user.role === 'agent' && id(complaint.assignedTo) === id(user._id)) || (user.role === 'user' && id(complaint.user) === id(user._id));
}
export function publicComplaint(value) {
  if (Array.isArray(value)) return value.map(publicComplaint);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const object = value.toObject ? value.toObject() : value;
  if (object.constructor !== Object) return object;
  return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, key === 'updates' && Array.isArray(entry) ? entry.filter(update => !update.isInternal).map(publicComplaint) : publicComplaint(entry)]));
}
export async function complaintAccess(req, res, next) {
  try {
    if (req.user.role === 'user') {
      const json = res.json.bind(res);
      res.json = body => json(publicComplaint(body));
    }
    for (const key of ['status','category','priority','assignedTo','userId','sortBy','sortOrder']) {
      if (req.query[key] !== undefined && typeof req.query[key] !== 'string') return res.status(400).json({ error: 'Invalid query parameter' });
    }
    if (req.query.limit !== undefined && (!Number.isInteger(Number(req.query.limit)) || Number(req.query.limit) < 1 || Number(req.query.limit) > 100)) return res.status(400).json({ error: 'Limit must be 1–100' });
    if (req.query.page !== undefined && (!Number.isInteger(Number(req.query.page)) || Number(req.query.page) < 1)) return res.status(400).json({ error: 'Invalid page' });
    if (req.body.status && !statuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
    if (req.path.includes('bulk') && req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
    const ticketId = req.path.split('/')[1];
    if (/^[a-f0-9]{24}$/i.test(ticketId)) {
      const complaint = await Complaint.findById(ticketId);
      if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
      if (!canAccessComplaint(req.user, complaint)) return res.status(403).json({ error: 'Access denied' });
    }
    next();
  } catch (error) { next(error); }
}
