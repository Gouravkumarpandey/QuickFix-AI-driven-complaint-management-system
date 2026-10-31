import { emitComplaintEvent } from '../services/complaintEvents.js';
import { getSettings } from '../services/settingsService.js';
import { complaintAccess, authorizeComplaint } from '../middleware/complaintAccess.js';
import express from 'express';
import { Complaint } from '../models/Complaint.js';
import { User, findUserById } from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateComplaint, validateComplaintUpdate } from '../validators/complaintValidators.js';
import aiService from '../services/aiService.js';
import { sendComplaintConfirmationEmail, sendComplaintResolvedEmail } from '../services/emailService.js';
import { publishEvent } from '../../utils/snsPublisher.js';
import { triggerComplaintCreatedSMS, triggerComplaintResolvedSMS } from '../services/smsTriggers.js';
// Redis cache disabled - uncomment when Redis is enabled
// import { invalidateComplaintCache } from '../services/cacheService.js';

const router = express.Router();
router.use(authenticate, authorize('user', 'agent', 'admin'), complaintAccess);
router.param('id', authorizeComplaint);

// Get all complaints for the logged-in user (user's complaint history)
router.get('/my-complaints', authenticate, asyncHandler(async (req, res) => {
  const {
    status,
    category,
    priority,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build filter object - only for current user
  const filter = { user: req.user._id };

  // Apply additional filters
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  // Fetch complaints
  const complaints = await Complaint.find(filter)
    .populate('user', 'name username email')
    .populate('assignedTo', 'name username email')
    .populate('resolution.resolvedBy', 'name username email')
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Complaint.countDocuments(filter);

  // Get statistics for user's complaints
  const stats = {
    total: total,
    open: await Complaint.countDocuments({ user: req.user._id, status: 'Open' }),
    inProgress: await Complaint.countDocuments({ user: req.user._id, status: 'In Progress' }),
    resolved: await Complaint.countDocuments({ user: req.user._id, status: 'Resolved' }),
    closed: await Complaint.countDocuments({ user: req.user._id, status: 'Closed' })
  };

  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role
    },
    complaints,
    stats,
    pagination: {
      current: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      total,
      hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
      hasPrev: parseInt(page) > 1
    }
  });
}));

// Get all complaints (with filters)
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const {
    status,
    category,
    priority,
    assignedTo,
    userId,
    isEscalated,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build filter object
  const filter = {};

  // Regular users can only see their own complaints
  if (req.user.role === 'user') {
    filter.user = req.user._id; // Use 'user' field, not 'userId'
  } else if (userId && (req.user.role === 'admin' || req.user.role === 'agent')) {
    filter.user = userId; // Use 'user' field, not 'userId'
  }

  // Agents can ONLY see complaints assigned directly to them (by their _id)
  if (req.user.role === 'agent') {
    filter.assignedTo = req.user._id;
    console.log(`🔍 Agent ${req.user.email} (${req.user._id}) fetching their assigned complaints`);
  }

  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  if (assignedTo && req.user.role === 'admin') filter.assignedTo = assignedTo;
  if (isEscalated !== undefined) filter.isEscalated = isEscalated === 'true';

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const complaints = await Complaint.find(filter)
    .populate('user', 'name username email')
    .populate('assignedTo', 'name username email')
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

// Get complaint by ID
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id)
    .populate('user', 'name username email')
    .populate('assignedTo', 'name username email')
    .populate('updates.updatedBy', 'name email');

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check permissions (user field contains the user who created the complaint)
  if (req.user.role === 'user' && (complaint.user._id || complaint.user).toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(complaint);
}));

// Create new complaint
router.post('/', authenticate, asyncHandler(async (req, res) => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🆕 NEW COMPLAINT CREATION REQUEST');
  console.log('═══════════════════════════════════════════════════════');

  console.log('👤 REQUEST USER:', JSON.stringify({
    id: req.user?._id,
    email: req.user?.email,
    role: req.user?.role,
    name: req.user?.name
  }, null, 2));
  console.log('📋 HEADERS:', JSON.stringify({
    'content-type': req.headers['content-type'],
    'authorization': req.headers.authorization ? 'Bearer ***' : 'MISSING',
    'origin': req.headers.origin
  }, null, 2));
  console.log('═══════════════════════════════════════════════════════');

  const { error } = validateComplaint(req.body);
  if (error) {
    console.error('❌ VALIDATION ERROR:', error.details[0].message);
    return res.status(400).json({ error: error.details[0].message });
  }

  const { title, description, category, attachments } = req.body;

  console.log('✅ Validation passed');
  console.log('   Title:', title);
  console.log('   Category:', category);
  console.log('   Description length:', description?.length || 0);

  // Import Anthropic service for AI validation
  const anthropicService = (await import('../services/anthropicService.js')).default;

  // AI VALIDATION: Check if complaint is genuine
  console.log('🤖 AI Validation: Analyzing complaint authenticity...');
  try {
    const validation = await anthropicService.validateComplaint(title, description);
    console.log('   Validation result:', validation);

    if (!validation.isValid) {
      console.error('❌ AI REJECTED: Complaint appears to be invalid/gibberish');
      console.error('   Reason:', validation.reason);
      console.error('   Confidence:', validation.confidence);

      return res.status(400).json({
        error: 'Invalid complaint detected',
        message: 'Your complaint appears to contain invalid or meaningless content. Please provide a genuine description of your issue.',
        reason: validation.reason,
        aiAnalysis: {
          isValid: false,
          confidence: validation.confidence,
          model: validation.model
        }
      });
    }

    console.log('✅ AI APPROVED: Complaint is genuine');
    console.log('   Reason:', validation.reason);
    console.log('   Confidence:', validation.confidence);
  } catch (validationError) {
    console.error('⚠️  AI validation error (proceeding anyway):', validationError.message);
    // Continue with complaint creation even if validation fails
  }

  // Use AI service to analyze the complaint (with fallback)
  let aiAnalysis = { priority: 'Medium', sentiment: 'Neutral', category: category || 'General Inquiry', keywords: [] };
  try {
    if (aiService && typeof aiService.classifyComplaint === 'function') {
      aiAnalysis = await aiService.classifyComplaint(description);
    } else {
      console.log('⚠️ AI service not available, using default classification');
    }
  } catch (error) {
    console.error('❌ AI classification failed:', error.message);
    console.log('   Using fallback classification');
  }

  // Calculate SLA target based on priority
  const slaHours = {
    'Critical': 4,
    'High': 24,
    'Medium': 48,
    'Low': 72
  };
  const settings = await getSettings();
  const targetHours = settings.slaTargets?.[aiAnalysis.priority] || slaHours[aiAnalysis.priority] || 48;

  console.log('🏗️  Creating complaint object...');
  console.log('   User ID for complaint:', req.user._id);
  console.log('   Category:', category || aiAnalysis.category);
  console.log('   Priority:', aiAnalysis.priority);
  console.log('   Target resolution hours:', targetHours);

  const complaint = new Complaint({
    user: req.user._id, // Links complaint to the authenticated user
    title,
    description,
    category: ({ Technical: 'Technical Support', Service: 'Customer Service', Product: 'Product Quality', General: 'General Inquiry' })[category] || category || aiAnalysis.category,
    priority: aiAnalysis.priority,
    status: 'Open',
    attachments: attachments || [],
    sla: {
      resolutionTime: {
        target: targetHours,
        actual: null,
        met: null
      },
      responseTime: {
        target: Math.min(4, targetHours / 4),
        actual: null,
        met: null
      }
    },
    aiAnalysis: {
      sentiment: aiAnalysis.sentiment || 'Neutral',
      confidence: aiAnalysis.confidence || 0.7,
      keywords: aiAnalysis.keywords || [],
      analyzedAt: new Date()
    },
    updates: [{
      message: 'Complaint has been created and classified automatically.',
      updatedBy: req.user._id,
      updateType: 'status_change',
      createdAt: new Date(),
      isInternal: false
    }]
  });

  console.log('💾 Attempting to save complaint to MongoDB...');
  console.log('   Complaint object created:', {
    hasUser: !!complaint.user,
    hasTitle: !!complaint.title,
    hasDescription: !!complaint.description,
    hasCategory: !!complaint.category
  });

  try {
    await complaint.save();
    console.log('✅ COMPLAINT SAVED SUCCESSFULLY!');
    console.log('   Complaint ID:', complaint._id);
    console.log('   Complaint Number:', complaint.complaintId);

    // Redis cache disabled
    // await invalidateComplaintCache(complaint._id.toString());
  } catch (saveError) {
    console.error('❌ MONGODB SAVE ERROR:', saveError);
    console.error('   Error name:', saveError.name);
    console.error('   Error message:', saveError.message);
    console.error('   Error stack:', saveError.stack);
    throw saveError;
  }

  // Generate AI summary if description is long enough
  if (description && description.length > 100) {
    try {
      const summaryResult = await aiService.summarize(description, 100, 30);
      complaint.aiSummary = {
        text: summaryResult.summary,
        confidence: summaryResult.error ? 0.5 : 0.85,
        model: summaryResult.model,
        generatedAt: new Date()
      };
      await complaint.save();
    } catch (error) {
      console.error('Failed to generate summary on creation:', error);
      // Continue without summary - not critical
    }
  }

  // Import the ticket assignment service and get io instance
  const { aiAssignToAgent, autoAssignToFreeAgent } = await import('../services/ticketAssignmentService.js');
  const { getIoInstance } = await import('../socket/socketHandlers.js');
  const { notifyComplaintCreated, notifyComplaintAssigned } = await import('../services/notificationService.js');

  try {
    // Get WebSocket instance for real-time notifications
    const io = getIoInstance();

    // AI-POWERED ASSIGNMENT: Use Anthropic Claude to intelligently assign ticket
    console.log('🤖 Attempting AI-powered agent assignment...');
    const { assignedAgent, message: assignMessage } = await aiAssignToAgent(complaint._id, io);

    // If an agent was assigned, update the response
    if (assignedAgent) {
      console.log(`✅ Complaint ${complaint.complaintId} AI-assigned to agent ${assignedAgent.name}`);
      console.log(`   Active tickets: ${assignedAgent.activeTickets}`);
      console.log(`   AI Confidence: ${assignedAgent.aiAssignment?.confidence}`);
      console.log(`   Reasoning: ${assignedAgent.aiAssignment?.reasoning}`);
      console.log(`   Method: ${assignedAgent.aiAssignment?.method}`);

      // Create notification for assigned agent
      try {
        await notifyComplaintAssigned(
          assignedAgent.id,
          complaint._id,
          complaint.title
        );
      } catch (notifError) {
        console.error('Failed to create assignment notification:', notifError);
      }
    } else {
      console.log(`ℹ️  ${assignMessage || 'No available agent'} for complaint ${complaint.complaintId}`);
    }
  } catch (err) {
    console.error('Error in AI ticket assignment:', err);
    // Continue even if assignment fails - complaint is still created
  }

  // Get updated complaint after assignment
  const updatedComplaint = await Complaint.findById(complaint._id)
    .populate('assignedTo', 'name username email')
    .populate('user', 'name username email');

  // Create notification for user about complaint creation
  try {
    console.log('🔔 Creating notification for user...');
    console.log('   User ID:', req.user._id);
    console.log('   Complaint ID:', complaint._id);
    console.log('   Complaint Title:', complaint.title);

    const notificationResult = await notifyComplaintCreated(
      req.user._id,
      complaint._id,
      complaint.title
    );

    console.log('✅ Notification created successfully:', notificationResult._id);
  } catch (notifError) {
    console.error('❌ Failed to create complaint notification:', notifError);
    console.error('   Error stack:', notifError.stack);
  }

  console.log('🔍 DEBUG: About to send email confirmation...');
  console.log('   Complaint ID:', complaint._id);
  console.log('   Updated complaint exists:', !!updatedComplaint);
  console.log('   User object:', updatedComplaint?.user);
  console.log('   User email:', updatedComplaint?.user?.email);
  console.log('   User name:', updatedComplaint?.user?.name);
  console.log('   Complaint Number:', updatedComplaint?.complaintId);
  console.log('   Request user:', { id: req.user?._id, email: req.user?.email, name: req.user?.name });

  // Send complaint confirmation email to user
  // Use req.user if populated user is not available
  const userEmail = updatedComplaint?.user?.email || req.user?.email;
  const userName = updatedComplaint?.user?.name || req.user?.name;

  // Trigger all notifications and event publishing in the background
  (async () => {
    // 1. Send Email Notification
    if (userEmail) {
      sendComplaintConfirmationEmail(
        userEmail,
        userName,
        updatedComplaint.complaintId,
        updatedComplaint.title,
        updatedComplaint.description,
        updatedComplaint.category,
        updatedComplaint.priority
      )
        .then(() => console.log(`✅ Confirmation email sent to ${userEmail} for complaint ${updatedComplaint.complaintId}`))
        .catch((emailError) => console.error('❌ Failed to send complaint confirmation email:', emailError.message));
    } else {
      console.error('❌ Cannot send email: User email is missing');
    }

    // 2. Send WhatsApp Notification
    const userPhoneNumber = req.user?.phoneNumber;
    if (userPhoneNumber) {
      import('../services/whatsappService.js')
        .then(({ sendComplaintRegistrationWhatsApp }) => {
          console.log(`📱 Sending WhatsApp notification to ${userPhoneNumber}...`);
          return sendComplaintRegistrationWhatsApp(
            userPhoneNumber,
            userName,
            updatedComplaint.complaintId,
            updatedComplaint.title,
            updatedComplaint.category,
            updatedComplaint.priority
          );
        })
        .then((whatsappResult) => {
          if (whatsappResult.success) {
            console.log(`✅ WhatsApp notification sent successfully for complaint ${updatedComplaint.complaintId}`);
          } else {
            console.log(`⚠️  WhatsApp notification failed: ${whatsappResult.error}`);
          }
        })
        .catch((whatsappError) => console.error('❌ Failed to send WhatsApp notification:', whatsappError.message));
    }

    // 3. Send SMS Notification
    if (req.user?.phoneNumber) {
      console.log(`📱 Sending SMS notification to ${req.user.phoneNumber}...`);
      triggerComplaintCreatedSMS(req.user, updatedComplaint.complaintId)
        .then(() => console.log(`✅ SMS notification sent successfully for complaint ${updatedComplaint.complaintId}`))
        .catch((smsError) => console.error('❌ Failed to send SMS notification:', smsError.message));
    }

    // 4. Publish SNS event
    publishEvent('ticket.created', {
      ticketId: updatedComplaint._id.toString(),
      complaintId: updatedComplaint.complaintId,
      userId: req.user._id.toString(),
      title: updatedComplaint.title,
      category: updatedComplaint.category,
      priority: updatedComplaint.priority,
      assignedTo: updatedComplaint.assignedTo?.toString() || null
    })
      .then(() => console.log(`📡 SNS Event published: ticket.created for ${updatedComplaint.complaintId}`))
      .catch((snsError) => console.error('❌ Failed to publish ticket.created event:', snsError.message));
  })();

  res.status(201).json(updatedComplaint);
}));

// Static bulk routes must precede /:id/status and /:id/assign.
async function bulkComplaints(req, res, kind) {
  const { complaintIds, assignedTo, status, message } = req.body;
  if (!Array.isArray(complaintIds) || !complaintIds.length || complaintIds.length > 100 || complaintIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) return res.status(400).json({ error: 'Provide 1–100 valid complaint IDs' });
  if (message !== undefined && (typeof message !== 'string' || message.length > 2000)) return res.status(400).json({ error: 'Invalid audit message' });
  const ids = [...new Set(complaintIds)];
  const tickets = await Complaint.find({ _id: { $in: ids } });
  if (tickets.length !== ids.length) return res.status(404).json({ error: 'One or more complaints were not found' });
  let changes;
  if (kind === 'assignment') {
    if (typeof assignedTo !== 'string' || !/^[a-f0-9]{24}$/i.test(assignedTo)) return res.status(400).json({ error: 'Valid agent ID required' });
    const { user: agent } = await findUserById(assignedTo);
    if (!agent || agent.role !== 'agent' || agent.isActive === false) return res.status(400).json({ error: 'Invalid agent' });
    changes = { assignedTo, status: 'In Progress' };
  } else {
    if (!['Open','In Progress','Under Review','Resolved','Closed','Escalated'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    changes = { status, ...(status === 'Resolved' ? { 'resolution.resolvedAt': new Date(), 'resolution.resolvedBy': req.user._id, 'resolution.description': message || 'Resolved by administrator' } : {}) };
  }
  const result = await Complaint.updateMany({ _id: { $in: ids } }, {
    $set: changes,
    $push: { updates: { message: message || (kind === 'assignment' ? 'Assigned by administrator' : `Status changed to ${status}`), updatedBy: req.user._id, updateType: kind === 'assignment' ? 'assignment' : 'status_change', isInternal: false, createdAt: new Date() } }
  }, { runValidators: true });
  const { refreshAgentAvailability } = await import('../services/agentService.js');
  const agents = [...new Set([...tickets.map(ticket => ticket.assignedTo?.toString()), assignedTo].filter(Boolean))];
  await Promise.all(agents.map(id => refreshAgentAvailability(id)));
  const updated = await Complaint.find({ _id: { $in: ids } });
  for (const complaint of updated) emitComplaintEvent(req.app.get('io'), complaint, 'complaintUpdated', { complaint });
  res.json({ message: 'Complaints updated successfully', modifiedCount: result.modifiedCount });
}
router.patch('/bulk/assign', authenticate, authorize('admin'), asyncHandler((req, res) => bulkComplaints(req, res, 'assignment')));
router.patch('/bulk/status', authenticate, authorize('admin'), asyncHandler((req, res) => bulkComplaints(req, res, 'status')));

// Update complaint status
router.patch('/:id/status', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const { status, message } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check if agent can update this complaint
  if (req.user.role === 'agent' &&
    complaint.assignedTo?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'You can only update complaints assigned to you' });
  }

  const oldStatus = complaint.status;
  complaint.status = status;
  complaint.updatedAt = new Date();

  console.log(`\n🔄 STATUS UPDATE REQUEST`);
  console.log(`   Complaint ID: ${complaint.complaintId} (${complaint._id})`);
  console.log(`   Current status in DB: ${oldStatus}`);
  console.log(`   New status requested: ${status}`);
  console.log(`   Status field updated in memory: ${complaint.status}`);
  console.log(`   Modified? ${complaint.isModified('status')}`);

  // Add update record — field names MUST match the Complaint schema
  // Schema requires: updatedBy (ObjectId), updateType (enum), message, isInternal, createdAt
  const updateRecord = {
    message: message || `Status changed from ${oldStatus} to ${status}`,
    updatedBy: req.user._id,
    updateType: 'status_change',
    previousValue: oldStatus,
    newValue: status,
    isInternal: false
  };
  complaint.updates.push(updateRecord);

  // Calculate resolution time if resolved or closed
  if (status === 'Resolved' || status === 'Closed') {
    // Store resolution details if resolved
    if (status === 'Resolved') {
      complaint.resolution = {
        description: message || 'Complaint resolved',
        resolvedBy: req.user._id,
        resolvedAt: new Date()
      };

      // Send WhatsApp notification for resolution
      try {
        const { sendComplaintResolvedWhatsApp } = await import('../services/whatsappService.js');
        const { findUserById } = await import('../models/User.js');

        // Get the complaint owner's phone number
        const { user: complaintOwner } = await findUserById(complaint.user);

        if (complaintOwner && complaintOwner.phoneNumber) {
          console.log(`📱 Sending WhatsApp resolution notification to ${complaintOwner.phoneNumber}...`);
          const whatsappResult = await sendComplaintResolvedWhatsApp(
            complaintOwner.phoneNumber,
            complaintOwner.name,
            complaint.complaintId,
            complaint.title,
            message || 'Your complaint has been resolved.'
          );

          if (whatsappResult.success) {
            console.log(`✅ WhatsApp resolution notification sent successfully for complaint ${complaint.complaintId}`);
          } else {
            console.log(`⚠️  WhatsApp resolution notification failed: ${whatsappResult.error}`);
          }
        } else {
          console.log('ℹ️  No phone number on complaint owner record, skipping WhatsApp notification');
        }
      } catch (whatsappError) {
        console.error('❌ Failed to send WhatsApp resolution notification:', whatsappError.message);
        // Continue even if WhatsApp fails
      }
    }
  }

  // Save the complaint FIRST before checking agent availability
  console.log(`\n💾 SAVING COMPLAINT TO DATABASE...`);
  console.log(`   Status before save: ${complaint.status}`);
  console.log(`   Resolution before save:`, complaint.resolution ? JSON.stringify(complaint.resolution) : 'None');

  await complaint.save();

  // Verify the save was successful by re-fetching from database
  const verifyComplaint = await Complaint.findById(complaint._id).lean();
  console.log(`\n✅ COMPLAINT SAVED AND VERIFIED`);
  console.log(`   Complaint ID: ${complaint.complaintId}`);
  console.log(`   Status in memory: ${complaint.status}`);
  console.log(`   Status in DB (verified): ${verifyComplaint.status}`);
  console.log(`   Resolution in DB:`, verifyComplaint.resolution ? 'Present' : 'None');
  console.log(`   Old status: ${oldStatus} → New status: ${verifyComplaint.status}`);

  if (verifyComplaint.status !== status) {
    console.error(`\n❌ CRITICAL ERROR: Status mismatch after save!`);
    console.error(`   Expected: ${status}`);
    console.error(`   Got: ${verifyComplaint.status}`);
  }

  // Get io instance early for use throughout
  const io = req.app.get('io');

  // Send resolution email and SMS to user in the background if complaint is marked as resolved
  if (status === 'Resolved') {
    (async () => {
      try {
        const { user: complaintUser } = await findUserById(complaint.user);

        if (!complaintUser) {
          console.log('⚠️  User not found for resolved complaint notifications');
          return;
        }

        // Send Email Notification in background
        const emailPromise = complaintUser.email
          ? sendComplaintResolvedEmail(
              complaintUser.email,
              complaintUser.name || complaintUser.username,
              complaint.complaintId,
              complaint.title
            )
              .then(() => console.log(`✅ Resolution email sent successfully for complaint ${complaint.complaintId}`))
              .catch((emailError) => console.error('❌ Failed to send resolution email:', emailError.message))
          : Promise.resolve();

        // Send SMS Notification in background
        const smsPromise = complaintUser.phoneNumber
          ? triggerComplaintResolvedSMS(complaintUser, complaint.complaintId)
              .then(() => console.log(`✅ Resolution SMS sent successfully for complaint ${complaint.complaintId}`))
              .catch((smsError) => console.error('❌ Failed to send resolution SMS:', smsError.message))
          : Promise.resolve();

        await Promise.all([emailPromise, smsPromise]);
      } catch (err) {
        console.error('❌ Error during background complaint resolution notifications:', err);
      }
    })();
  }

  // NOW check if the assigned agent should be marked available (after save)
  if ((status === 'Resolved' || status === 'Closed') && complaint.assignedTo) {
    // Import the agent service
    const { refreshAgentAvailability } = await import('../services/agentService.js');

    try {
      // This will check if agent has any remaining active complaints
      // and update their availability accordingly
      console.log(`🔍 Checking agent availability for ${complaint.assignedTo}...`);
      const updatedAgent = await refreshAgentAvailability(complaint.assignedTo);
      console.log(`🔄 Agent availability refreshed: ${updatedAgent.availability}`);

      // Broadcast agent status update via socket
      if (io) {
        io.to('admin').emit('agent_status_update', {
          agentId: updatedAgent._id.toString(),
          availability: updatedAgent.availability,
          name: updatedAgent.name,
          email: updatedAgent.email
        });
        console.log(`📡 Agent status broadcast: ${updatedAgent.name} is now ${updatedAgent.availability}`);
      }
    } catch (err) {
      console.error('❌ Error updating agent availability:', err);
    }
  }

  // Get populated complaint for response - FETCH FRESH FROM DB
  const populatedComplaint = await Complaint.findById(complaint._id)
    .populate('user', 'name email')
    .populate('assignedTo', 'name email')
    .populate('resolution.resolvedBy', 'name email')
    .lean(); // Use lean() for performance and to get plain object

  console.log(`\n📊 POPULATED COMPLAINT FOR RESPONSE`);
  console.log(`   Status: ${populatedComplaint.status}`);
  console.log(`   Resolution:`, populatedComplaint.resolution ? 'Present' : 'None');
  console.log(`   Assigned to:`, populatedComplaint.assignedTo?.name || 'Unassigned');

  if (populatedComplaint.status !== status) {
    console.error(`\n❌ CRITICAL: Response status doesn't match requested status!`);
    console.error(`   Requested: ${status}`);
    console.error(`   Returning: ${populatedComplaint.status}`);
  }

  // Invalidate cache since complaint was updated
  // await invalidateComplaintCache(complaint._id.toString());

  // Emit socket event for real-time updates to user dashboard
  if (io) {
    // Create complete complaint data for socket event
    const complaintData = {
      _id: populatedComplaint._id,
      complaintId: populatedComplaint.complaintId,
      title: populatedComplaint.title,
      description: populatedComplaint.description,
      status: populatedComplaint.status,
      category: populatedComplaint.category,
      priority: populatedComplaint.priority,
      userId: populatedComplaint.user?._id || populatedComplaint.user,
      user: populatedComplaint.user,
      assignedTo: populatedComplaint.assignedTo?._id || populatedComplaint.assignedTo,
      assignedAgentName: populatedComplaint.assignedTo?.name,
      assignedAgentEmail: populatedComplaint.assignedTo?.email,
      createdAt: populatedComplaint.createdAt,
      updatedAt: populatedComplaint.updatedAt,
      resolvedAt: status === 'Resolved' ? populatedComplaint.resolution?.resolvedAt : null,
      resolution: populatedComplaint.resolution,
      updates: populatedComplaint.updates.filter(update => !update.isInternal)
    };

    // Emit to specific user for their dashboard (using both patterns for compatibility)
    const userId = (complaint.user._id || complaint.user).toString();
    io.to(`user:${userId}`).emit('complaintUpdated', { complaint: complaintData });
    io.to(`user:${userId}`).emit('complaint_status_updated', { complaint: complaintData });

    // Broadcast to all for general updates
    io.to('admin').emit('complaintStatusChanged', {
      complaintId: complaint._id,
      status: complaint.status,
      updatedBy: req.user._id,
      complaint: complaintData
    });

    console.log(`🔔 Socket events emitted:`);
    console.log(`   - complaintUpdated to user:${userId}`);
    console.log(`   - complaint_status_updated to user:${userId}`);
    console.log(`   - complaintStatusChanged (broadcast)`);
    console.log(`   Status: ${complaint.status}`);
  }

  // Publish event to SNS for ticket resolution (triggers worker for auto-assignment)
  if (status === 'Resolved') {
    try {
      await publishEvent('ticket.resolved', {
        ticketId: complaint._id.toString(),
        complaintId: complaint.complaintId,
        agentId: complaint.assignedTo?.toString() || null,
        resolvedBy: req.user._id.toString(),
        resolvedAt: new Date().toISOString(),
        userId: (complaint.user._id || complaint.user).toString(),
        title: complaint.title,
        priority: complaint.priority
      });
      console.log(`📡 SNS Event published: ticket.resolved for ${complaint.complaintId}`);
      console.log(`   Event will trigger worker to mark agent as free and auto-assign next ticket`);
    } catch (snsError) {
      console.error('❌ Failed to publish ticket.resolved event:', snsError.message);
      // Continue even if SNS fails
    }
  }

  console.log(`\n📤 SENDING RESPONSE TO CLIENT`);
  console.log(`   Complaint ID: ${populatedComplaint.complaintId}`);
  console.log(`   Status: ${populatedComplaint.status}`);
  console.log(`   Has resolution:`, !!populatedComplaint.resolution);
  console.log(`   ================================\n`);

  res.json(populatedComplaint);
}));

// Assign complaint to agent
router.patch('/:id/assign', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { agentId } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'Agent ID is required' });
  }

  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const { user: targetAgent } = await findUserById(agentId);
  if (!targetAgent || targetAgent.role !== 'agent' || targetAgent.isActive === false) return res.status(400).json({ error: 'Invalid agent' });
  complaint.assignedTo = agentId;
  complaint.status = 'In Progress';
  complaint.updatedAt = new Date();

  // Add update record
  complaint.updates.push({
    message: `Complaint assigned to agent`,
    updatedBy: req.user._id,
    timestamp: new Date(),
    updateType: 'assignment',
    isInternal: false
  });

  await complaint.save();
  console.log(`✅ Complaint ${complaint.complaintId} assigned to agent ${agentId}`);

  // Mark the agent as busy after assignment
  try {
    const { updateAgentAvailability } = await import('../services/agentService.js');
    await updateAgentAvailability(agentId, 'busy');
    console.log(`📌 Agent ${agentId} marked as BUSY after ticket assignment`);
  } catch (err) {
    console.error('❌ Error updating agent availability to busy:', err);
  }

  // Emit socket event for complaint assignment
  const io = req.app.get('io');
  if (io) {
    io.to('admin').emit('complaintAssigned', {
      complaintId: complaint._id,
      assignedTo: agentId,
      assignedBy: req.user._id
    });

    // Also broadcast agent status update
    try {
      const agent = await User.findById(agentId);
      if (agent) {
        io.to('admin').emit('agent_status_update', {
          agentId: agent._id.toString(),
          availability: 'busy',
          name: agent.name,
          email: agent.email
        });
        console.log(`📡 Agent status broadcast: ${agent.name} is now BUSY`);
      }
    } catch (socketErr) {
      console.error('❌ Error broadcasting agent status:', socketErr);
    }
  }

  // Invalidate cache since complaint was assigned
  // await invalidateComplaintCache(complaint._id.toString());

  res.json(complaint);
}));

// Add comment/update to complaint
router.post('/:id/updates', authenticate, asyncHandler(async (req, res) => {
  const { error } = validateComplaintUpdate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { message, type = 'comment', isInternal = false, attachments } = req.body;
  if (req.user.role === 'user' && (isInternal || type !== 'comment')) return res.status(403).json({ error: 'Customers can only add public comments' });

  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check permissions (user field contains the user who created the complaint)
  if (req.user.role === 'user' && (complaint.user._id || complaint.user).toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'Access denied' });
  }

  complaint.updates.push({
    message,
    updatedBy: req.user._id,
    timestamp: new Date(),
    updateType: type,
    isInternal,
    attachments: attachments || []
  });

  complaint.updatedAt = new Date();
  await complaint.save();

  // Invalidate cache since complaint was updated
  // Caching is disabled; no invalidation required.

  // Emit socket event
  const io = req.app.get('io');
  emitComplaintEvent(io, complaint, 'complaintCommentAdded', {
    complaintId: complaint._id,
    update: complaint.updates[complaint.updates.length - 1],
    addedBy: req.user._id
  }, isInternal);

  res.json(complaint);
}));

// Escalate complaint
router.patch('/:id/escalate', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Escalation reason is required' });
  }

  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  complaint.escalation = { escalatedBy: req.user._id, reason, escalatedAt: new Date(), resolved: false };
  complaint.status = 'Escalated';
  complaint.updatedAt = new Date();

  // Add update record
  complaint.updates.push({
    message: `Complaint escalated: ${reason}`,
    updatedBy: req.user._id,
    timestamp: new Date(),
    updateType: 'escalation',
    isInternal: false
  });

  await complaint.save();

  // Emit socket event
  const io = req.app.get('io');
  io.to('admin').emit('complaintEscalated', {
    complaintId: complaint._id,
    reason,
    escalatedBy: req.user._id
  });

  res.json(complaint);
}));

// Submit feedback
router.post('/:id/feedback', authenticate, asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000))) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }

  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Only the complaint owner can submit feedback
  if ((complaint.user._id || complaint.user).toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'Only the complaint owner can submit feedback' });
  }

  // Can only submit feedback for resolved/closed complaints
  if (!['Resolved', 'Closed'].includes(complaint.status)) {
    return res.status(400).json({ error: 'Feedback can only be submitted for resolved or closed complaints' });
  }

  complaint.customerSatisfaction = { rating, feedback: comment || '', submittedAt: new Date() };
  complaint.resolution.satisfactionRating = rating;
  complaint.resolution.feedback = comment || '';

  complaint.updatedAt = new Date();

  await complaint.save();

  res.json({ message: 'Feedback submitted successfully', feedback: { rating: complaint.customerSatisfaction.rating, comment: complaint.customerSatisfaction.feedback } });
}));

// AI-powered auto-assignment endpoint
router.post('/auto-assign', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { complaintId } = req.body;

  const complaint = await Complaint.findById(complaintId);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Import AI assignment service
  const { aiAssignToAgent } = await import('../services/ticketAssignmentService.js');
  const { getIoInstance } = await import('../socket/socketHandlers.js');

  try {
    const io = getIoInstance();

    // Use AI-powered assignment
    console.log(`🤖 Admin triggered AI assignment for complaint ${complaint.complaintId}`);
    const { assignedAgent, message: assignMessage } = await aiAssignToAgent(complaint._id, io);

    if (!assignedAgent) {
      return res.status(400).json({
        error: assignMessage || 'No available agents found',
        success: false
      });
    }

    // Get updated complaint
    const updatedComplaint = await Complaint.findById(complaint._id)
      .populate('assignedTo', 'name email')
      .populate('user', 'name email');

    res.json({
      success: true,
      message: 'Complaint AI-assigned successfully',
      assignedTo: {
        id: assignedAgent.id,
        name: assignedAgent.name,
        activeTickets: assignedAgent.activeTickets
      },
      aiAssignment: assignedAgent.aiAssignment,
      complaint: updatedComplaint
    });
  } catch (error) {
    console.error('Error in AI auto-assignment:', error);
    res.status(500).json({
      error: 'Failed to auto-assign complaint',
      message: error.message
    });
  }
}));

// Add internal notes (for agents and admins)
router.post('/:id/internal-notes', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const { note } = req.body;

  if (typeof note !== 'string' || !note.trim() || note.length > 2000) {
    return res.status(400).json({ error: 'Note content is required' });
  }

  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check if agent is assigned to this complaint or is admin
  if (req.user.role === 'agent' && complaint.assignedTo?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'You can only add notes to complaints assigned to you' });
  }

  const internalNote = {
    message: note,
    updatedBy: req.user._id,
    timestamp: new Date(),
    updateType: 'comment',
    isInternal: true
  };

  complaint.updates.push(internalNote);
  complaint.updatedAt = new Date();
  await complaint.save();

  res.json({
    message: 'Internal note added successfully',
    note: internalNote
  });
}));

// Get internal notes for a complaint
router.get('/:id/internal-notes', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check if agent is assigned to this complaint or is admin
  if (req.user.role === 'agent' && complaint.assignedTo?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'You can only view notes for complaints assigned to you' });
  }

  const internalNotes = complaint.updates.filter(update => update.isInternal === true);

  res.json({ internalNotes });
}));

// Escalate complaint


// Get dashboard statistics for current user
router.get('/stats/dashboard', authenticate, asyncHandler(async (req, res) => {
  let matchFilter = {};

  // Role-based filtering
  if (req.user.role === 'user') {
    matchFilter.user = req.user._id; // Use 'user' field, not 'userId'
  } else if (req.user.role === 'agent') {
    matchFilter.assignedTo = req.user._id;
  }
  // Admin sees all complaints

  const [
    totalComplaints,
    openComplaints,
    inProgressComplaints,
    resolvedComplaints,
    escalatedComplaints,
    overdueComplaints
  ] = await Promise.all([
    Complaint.countDocuments(matchFilter),
    Complaint.countDocuments({ ...matchFilter, status: 'Open' }),
    Complaint.countDocuments({ ...matchFilter, status: 'In Progress' }),
    Complaint.countDocuments({ ...matchFilter, status: 'Resolved' }),
    Complaint.countDocuments({ ...matchFilter, isEscalated: true }),
    Complaint.countDocuments({
      ...matchFilter,
      status: { $nin: ['Resolved', 'Closed'] },
      slaTarget: { $lt: new Date() }
    })
  ]);

  const resolutionRate = totalComplaints > 0 ? ((resolvedComplaints / totalComplaints) * 100).toFixed(1) : 0;

  res.json({
    totalComplaints,
    openComplaints,
    inProgressComplaints,
    resolvedComplaints,
    escalatedComplaints,
    overdueComplaints,
    resolutionRate: parseFloat(resolutionRate)
  });
}));

// Generate AI draft reply for a complaint
router.post('/:id/generate-reply', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id)
    .populate('user', 'name username email');

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check if agent can generate reply for this complaint
  if (req.user.role === 'agent' &&
    complaint.assignedTo?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'You can only generate replies for complaints assigned to you' });
  }

  try {
    // TODO: Implement KB context retrieval based on complaint category
    // For now, use some basic context based on category
    const kbContext = getKBContextForCategory(complaint.category);

    // Determine tone based on sentiment
    const tone = complaint.aiAnalysis?.sentiment === 'Negative' ? 'empathetic' : 'polite';

    // Generate draft reply using AI service
    const aiReply = await aiService.generateReply(
      complaint.description,
      kbContext,
      tone
    );

    // Store the AI draft reply in the complaint
    complaint.aiDraftReply = {
      text: aiReply.draft_reply,
      confidence: aiReply.confidence,
      needsHumanReview: aiReply.needs_human_review,
      model: aiReply.model,
      source: aiReply.source,
      tone: aiReply.tone_used,
      generatedAt: new Date(),
      wasUsed: false,
      wasEdited: false
    };

    await complaint.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`complaint:${complaint._id}`).emit('draftReplyGenerated', {
        complaintId: complaint._id,
        draftReply: complaint.aiDraftReply
      });
    }

    res.json({
      success: true,
      draftReply: complaint.aiDraftReply,
      message: aiReply.needs_human_review
        ? 'Draft generated - human review required before sending'
        : 'Draft generated - please review before sending'
    });
  } catch (error) {
    console.error('Error generating AI reply:', error);
    res.status(500).json({
      error: 'Failed to generate draft reply',
      details: error.message
    });
  }
}));

// Generate AI summary for a complaint
router.post('/:id/generate-summary', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  try {
    // Generate summary using AI service
    const aiSummary = await aiService.summarize(complaint.description, 100, 30);

    // Store the AI summary in the complaint
    complaint.aiSummary = {
      text: aiSummary.summary,
      confidence: aiSummary.error ? 0.5 : 0.85,
      model: aiSummary.model,
      generatedAt: new Date()
    };

    await complaint.save();

    res.json({
      success: true,
      summary: complaint.aiSummary
    });
  } catch (error) {
    console.error('Error generating AI summary:', error);
    res.status(500).json({
      error: 'Failed to generate summary',
      details: error.message
    });
  }
}));

// Helper function to get KB context based on category
function getKBContextForCategory(category) {
  // This is a simplified version - in production, use semantic search on KB
  const kbDatabase = {
    'Technical Support': [
      'For technical issues, first verify all cables are connected and device is powered on.',
      'Standard troubleshooting includes: restart device, clear cache, update software.',
      'Technical support response time is 24-48 hours for non-urgent issues.'
    ],
    'Billing': [
      'Refunds are processed within 5-7 business days to the original payment method.',
      'Bill credits are automatically applied for service outages exceeding 24 hours.',
      'For billing disputes, please provide invoice number and specific charges in question.'
    ],
    'Product Quality': [
      'Quality concerns are taken seriously and reviewed by our QA team within 48 hours.',
      'Defective products can be returned within 30 days for full refund or replacement.',
      'Please include photos or videos of the issue to expedite resolution.'
    ],
    'Customer Service': [
      'We apologize for any inconvenience. Customer satisfaction is our top priority.',
      'All feedback is reviewed by management and used to improve our services.',
      'You can escalate concerns to a supervisor by calling our dedicated line.'
    ],
    'Delivery': [
      'Standard delivery time is 3-5 business days. Delays may occur due to weather or holidays.',
      'Track your order using the tracking number provided in your confirmation email.',
      'For missing or delayed deliveries, please provide order number and expected delivery date.'
    ],
    'Account Issues': [
      'Account recovery requires verification via email or phone number on file.',
      'Password resets are sent to registered email and expire after 24 hours.',
      'For security reasons, account changes require identity verification.'
    ]
  };

  return kbDatabase[category] || [
    'Thank you for contacting us. Our support team will assist you promptly.',
    'We take customer concerns seriously and aim to resolve issues within 48 hours.',
    'Please provide any additional details that may help us resolve your issue faster.'
  ];
}

// Accept AI draft reply (save agent's reviewed/edited version)
router.post('/:id/accept-reply', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const { reply } = req.body;

  if (!reply || !reply.trim()) {
    return res.status(400).json({ error: 'Reply text is required' });
  }

  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check authorization
  if (req.user.role === 'agent' &&
    complaint.assignedTo?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'You can only accept replies for complaints assigned to you' });
  }

  try {
    // Update the draft reply with agent's version
    if (complaint.aiDraftReply) {
      const wasEdited = complaint.aiDraftReply.text !== reply;
      complaint.aiDraftReply.text = reply;
      complaint.aiDraftReply.wasEdited = wasEdited;
      complaint.aiDraftReply.needsHumanReview = false; // Agent has reviewed
    } else {
      // If no AI draft exists, create one (agent manually created reply)
      complaint.aiDraftReply = {
        text: reply,
        confidence: 1.0, // Manual replies have 100% confidence
        needsHumanReview: false,
        model: 'manual',
        source: 'agent',
        tone: 'professional',
        generatedAt: new Date(),
        wasUsed: false,
        wasEdited: false
      };
    }

    await complaint.save();

    res.json({
      success: true,
      complaint: complaint,
      message: 'Draft reply accepted and saved'
    });
  } catch (error) {
    console.error('Error accepting draft reply:', error);
    res.status(500).json({
      error: 'Failed to save draft reply',
      details: error.message
    });
  }
}));

// Send reply to customer (via email/notification)
router.post('/:id/send-reply', authenticate, authorize('agent', 'admin'), asyncHandler(async (req, res) => {
  const { reply } = req.body;

  if (!reply || !reply.trim()) {
    return res.status(400).json({ error: 'Reply text is required' });
  }

  const complaint = await Complaint.findById(req.params.id)
    .populate('user', 'name username email');

  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Check authorization
  if (req.user.role === 'agent' &&
    complaint.assignedTo?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: 'You can only send replies for complaints assigned to you' });
  }

  try {
    // Import email service if available
    const emailService = await import('../services/emailService.js').catch(() => null);
    const notificationService = await import('../services/notificationService.js').catch(() => null);

    // Send email to customer
    if (emailService?.default?.sendEmail) {
      await emailService.default.sendEmail({
        to: complaint.user.email,
        subject: `Re: Your complaint - ${complaint.title}`,
        html: `
          <h2>Response to Your Complaint</h2>
          <p>Dear ${complaint.user.name || 'Customer'},</p>
          <p>${reply.replace(/\n/g, '<br>')}</p>
          <hr>
          <p><small>Complaint ID: ${complaint._id}<br>
          Original message: ${complaint.description}</small></p>
        `
      });
    }

    // Create notification
    if (notificationService?.default?.createNotification) {
      await notificationService.default.createNotification({
        userId: complaint.user._id,
        type: 'complaint_reply',
        title: 'New Reply to Your Complaint',
        message: reply.substring(0, 200) + (reply.length > 200 ? '...' : ''),
        relatedId: complaint._id,
        relatedModel: 'Complaint'
      });
    }

    // Add reply to complaint updates
    complaint.updates.push({
      author: `${req.user.firstName} ${req.user.lastName}`,
      message: reply,
      type: 'agent_reply',
      timestamp: new Date()
    });

    // Mark draft reply as used if it exists
    if (complaint.aiDraftReply) {
      complaint.aiDraftReply.wasUsed = true;
    }

    // Update status if still Open
    if (complaint.status === 'Open') {
      complaint.status = 'In Progress';
    }

    complaint.updatedAt = new Date();
    await complaint.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`complaint:${complaint._id}`).emit('replyPosted', {
        complaintId: complaint._id,
        reply: reply,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      sentAt: new Date().toISOString(),
      messageId: `msg_${Date.now()}`,
      message: 'Reply sent to customer successfully'
    });
  } catch (error) {
    console.error('Error sending reply:', error);
    res.status(500).json({
      error: 'Failed to send reply',
      details: error.message
    });
  }
}));

export default router;

