import { getSettings } from './settingsService.js';
import { User, AgentUser } from '../models/User.js';
import { Complaint } from '../models/Complaint.js';
import { createNotification } from './notificationService.js';
import anthropicService from './anthropicService.js';
import { updateAgentAvailability } from './agentService.js';

// Automatic assignment uses the capacity rule: one active complaint per agent.
async function assignAvailable(complaintId, io, useAI) {
  const settings = await getSettings();
  if (settings.autoAssignment?.enabled === false) return { assignedAgent: null, message: 'Automatic assignment disabled' };
  const complaint = await Complaint.findById(complaintId);
  if (!complaint) throw new Error('Complaint not found');
  if (complaint.assignedTo) return { complaint, assignedAgent: null, message: 'Already assigned' };
  let candidates = await AgentUser.find({ availability: 'available', isActive: { $ne: false } }).lean();
  const loads = await Promise.all(candidates.map(agent => Complaint.countDocuments({ assignedTo: agent._id, status: { $nin: ['Resolved','Closed'] } })));
  candidates = candidates.filter((_, index) => loads[index] === 0);
  if (useAI && candidates.length) {
    try {
      const result = await anthropicService.assignTicketToAgent(complaint, candidates.map(agent => ({ id: agent._id, name: agent.name, email: agent.email, activeTickets: 0, expertise: agent.organization || 'General' })));
      if (result.success) candidates.sort((a, b) => Number(String(b._id) === String(result.agent.id)) - Number(String(a._id) === String(result.agent.id)));
    } catch { /* Availability-based assignment remains functional without AI. */ }
  }
  for (const candidate of candidates) {
    const claimed = await AgentUser.findOneAndUpdate({ _id: candidate._id, availability: 'available', isActive: { $ne: false } }, { $set: { availability: 'busy' } }, { new: true });
    if (!claimed) continue;
    let updated;
    try { updated = await Complaint.findOneAndUpdate({ _id: complaintId, assignedTo: null, status: 'Open' }, {
      $set: { assignedTo: claimed._id, status: 'In Progress' },
      $push: { updates: { message: `Assigned to ${claimed.name}`, updatedBy: claimed._id, updateType: 'assignment', createdAt: new Date() } }
    }, { new: true, runValidators: true });
    } catch (error) { await updateAgentAvailability(claimed._id, 'available'); throw error; }
    if (!updated) { await updateAgentAvailability(claimed._id, 'available'); return { complaint, assignedAgent: null, message: 'Ticket already claimed' }; }
    try { await createNotification({ userId: claimed._id, title: 'New Ticket Assignment', message: `Assigned ticket #${updated.complaintId}`, type: 'complaint_assigned', complaintId: updated._id }); } catch (error) { console.error('Assignment notification failed:', error.message); }
    if (io) { const { notifyAgentAssignment } = await import('../socket/handlers/complaintHandler.js'); notifyAgentAssignment(io, claimed._id, updated); }
    return { complaint: updated, assignedAgent: { id: claimed._id, name: claimed.name, email: claimed.email }, message: 'Assigned successfully' };
  }
  return { complaint, assignedAgent: null, message: 'No free agents available' };
}
export const aiAssignToAgent = (id, io = null) => assignAvailable(id, io, true);
export const autoAssignToFreeAgent = (id, io = null) => assignAvailable(id, io, false);

/**
 * Manually assign a complaint to a specific agent
 * @param {string} complaintId - The ID of the complaint to assign
 * @param {string} agentId - The ID of the agent to assign the complaint to
 * @param {string} adminId - The ID of the admin making the assignment
 * @returns {Promise<object>} The updated complaint
 */
export const manualAssignTicket = async (complaintId, agentId, adminId) => {
  try {
    const [complaint, agent] = await Promise.all([
      Complaint.findById(complaintId),
      AgentUser.findById(agentId)
    ]);

    if (!complaint) {
      throw new Error(`Complaint ${complaintId} not found`);
    }

    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.role !== 'agent') {
      throw new Error(`User ${agentId} is not an agent`);
    }

    // Check if the complaint is already assigned to the same agent
    if (complaint.assignedTo && complaint.assignedTo.toString() === agentId) {
      return { complaint, message: 'Complaint is already assigned to this agent' };
    }

    const previousAgent = complaint.assignedTo
      ? (await AgentUser.findById(complaint.assignedTo).select('name'))?.name
      : 'Unassigned';

    complaint.assignedTo = agentId;
    complaint.status = 'In Progress';
    complaint.updates.push({
      message: `Ticket manually assigned to agent ${agent.name} by admin`,
      updatedBy: adminId,
      updateType: 'assignment',
      previousValue: previousAgent,
      newValue: agent.name,
      createdAt: new Date(),
    });

    await complaint.save();

    // Create notification for the agent
    await createNotification({
      userId: agentId,
      title: 'New Ticket Assignment',
      message: `You have been assigned to ticket #${complaint.complaintId} by admin`,
      type: 'complaint_assigned',
      priority: 'high',
      complaintId: complaint._id,
      data: { complaintId: complaint.complaintId, assignedBy: adminId }
    });

    return { complaint, assignedAgent: { id: agentId, name: agent.name } };
  } catch (error) {
    console.error('Error in manualAssignTicket:', error.message);
    throw error;
  }
};

/**
 * Get a list of all agents with their current workload
 * @returns {Promise<Array>} List of agents with their current workload information
 */
export const getAgentsWithWorkload = async () => {
  try {
    // Get all agents from the 'agent' collection
    const agents = await AgentUser.find({}).select('name email').lean();

    // For each agent, get their workload
    const agentWorkloads = await Promise.all(
      agents.map(async (agent) => {
        const agentId = agent._id;

        // Count tickets by status for this agent
        const ticketCountsByStatus = await Complaint.aggregate([
          { $match: { assignedTo: agentId } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]);

        // Convert the array to an object for easier access
        const ticketCounts = {};
        ticketCountsByStatus.forEach(status => {
          ticketCounts[status._id] = status.count;
        });

        // Calculate the average resolution time for resolved tickets
        const resolvedComplaints = await Complaint.find({
          assignedTo: agentId,
          'resolution.resolvedAt': { $exists: true }
        }).sort({ 'resolution.resolvedAt': -1 }).limit(10).lean();

        let totalResolutionTime = 0;
        resolvedComplaints.forEach(complaint => {
          const createdAt = new Date(complaint.createdAt);
          const resolvedAt = new Date(complaint.resolution.resolvedAt);
          totalResolutionTime += resolvedAt - createdAt;
        });

        const avgResolutionTime = resolvedComplaints.length > 0
          ? totalResolutionTime / resolvedComplaints.length / (1000 * 60) // in minutes
          : 0;

        // Determine agent status based on workload
        const activeTickets = Object.entries(ticketCounts).filter(([status]) => !['Resolved','Closed'].includes(status)).reduce((sum, [, count]) => sum + count, 0);
        const status = activeTickets > 0 ? 'busy' : 'available';

        return {
          id: agentId.toString(),
          name: agent.name,
          email: agent.email,
          status,
          currentLoad: activeTickets,
          ticketsByStatus: {
            open: ticketCounts['Open'] || 0,
            inProgress: ticketCounts['In Progress'] || 0,
            resolved: ticketCounts['Resolved'] || 0,
            closed: ticketCounts['Closed'] || 0
          },
          avgResponseTime: Math.round(avgResolutionTime) + 'm',
          lastUpdated: new Date()
        };
      })
    );

    return agentWorkloads;
  } catch (error) {
    console.error('Error in getAgentsWithWorkload:', error.message);
    throw error;
  }
};