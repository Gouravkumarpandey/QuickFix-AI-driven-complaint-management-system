import { publicComplaint } from '../middleware/complaintAccess.js';
const id = value => String(value?._id || value || '');
export function emitComplaintEvent(io, complaint, event, payload, internal = false) {
  if (!io) return;
  let staff = io.to('admin');
  if (complaint.assignedTo) staff = staff.to(`agent:${id(complaint.assignedTo)}`);
  staff.emit(event, payload);
  if (!internal) io.to(`user:${id(complaint.user)}`).emit(event, publicComplaint(payload));
}
