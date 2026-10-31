import mongoose from 'mongoose';

const complaintSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Complaint title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Complaint description is required'],
    trim: true,
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: [
      'Technical Support',
      'Billing',
      'Product Quality',
      'Customer Service',
      'Delivery',
      'General Inquiry',
      'Refund Request',
      'Account Issues'
    ]
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed', 'Escalated'],
    default: 'Open'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentUser',
    default: null
  },
  complaintId: {
    type: String,
    unique: true,
    required: false
  },
  attachments: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    path: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  tags: [{
    type: String,
    trim: true
  }],
  aiAnalysis: {
    sentiment: {
      type: String,
      enum: ['Positive', 'Negative', 'Neutral']
    },
    urgencyScore: {
      type: Number,
      min: 0,
      max: 1
    },
    keywords: [String],
    confidence: Number,
    analyzedAt: Date
  },
  // AI-generated summary and reply
  aiSummary: {
    text: String,
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    model: String,
    generatedAt: Date
  },
  aiDraftReply: {
    text: String,
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    needsHumanReview: {
      type: Boolean,
      default: true
    },
    model: String,
    source: String,
    tone: String,
    generatedAt: Date,
    // Track if agent used/edited this draft
    wasUsed: {
      type: Boolean,
      default: false
    },
    wasEdited: {
      type: Boolean,
      default: false
    }
  },
  resolution: {
    description: String,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: Date,
    satisfactionRating: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String
  },
  updates: [{
    message: {
      type: String,
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updateType: {
      type: String,
      enum: ['status_change', 'assignment', 'comment', 'resolution', 'escalation'],
      default: 'comment'
    },
    previousValue: String,
    newValue: String,
    isInternal: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  escalation: {
    escalatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    escalatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    escalatedAt: Date,
    resolved: {
      type: Boolean,
      default: false
    }
  },
  sla: {
    responseTime: {
      target: Number, // in hours
      actual: Number,
      met: Boolean
    },
    resolutionTime: {
      target: Number, // in hours
      actual: Number,
      met: Boolean
    }
  },
  isUrgent: {
    type: Boolean,
    default: false
  },
  source: {
    type: String,
    enum: ['web', 'mobile', 'email', 'phone', 'chatbot'],
    default: 'web'
  },
  customerSatisfaction: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String,
    submittedAt: Date
  },
  // Added chat messages support for live communication between user and agent
  messages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    senderName: {
      type: String,
      required: true
    },
    senderRole: {
      type: String,
      enum: ['user', 'agent', 'admin', 'analytics', 'bot'],
      required: true
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    isRead: {
      type: Boolean,
      default: false
    }
  }],
  // Store original chatbot conversation that led to this ticket
  chatbotConversation: [{
    sender: {
      type: String,
      enum: ['user', 'bot'],
      required: true
    },
    text: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    troubleshootingStep: Number,
    metadata: mongoose.Schema.Types.Mixed
  }],
  troubleshootingAttempted: {
    type: Boolean,
    default: false
  },
  troubleshootingSteps: [{
    step: String,
    attempted: {
      type: Boolean,
      default: false
    },
    successful: {
      type: Boolean,
      default: false
    }
  }],
  // Track agent availability for automatic assignment
  agentStatus: {
    type: String,
    enum: ['available', 'busy', 'offline'],
    default: 'available'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for complaint age in hours
complaintSchema.virtual('ageInHours').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60));
});

// Virtual for time to resolution
complaintSchema.virtual('timeToResolution').get(function() {
  if (this.resolution && this.resolution.resolvedAt) {
    return Math.floor((this.resolution.resolvedAt - this.createdAt) / (1000 * 60 * 60));
  }
  return null;
});

// Virtual for overdue status
complaintSchema.virtual('isOverdue').get(function() {
  if (this.status === 'Resolved' || this.status === 'Closed') return false;
  
  const slaHours = this.sla?.resolutionTime?.target || 72; // Default 72 hours
  const ageHours = this.ageInHours;
  
  return ageHours > slaHours;
});

// Pre-save middleware to generate complaint ID
complaintSchema.pre('save', async function(next) {
  if (!this.complaintId) {
    // Use timestamp + random component for truly unique IDs
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.complaintId = `CMP-${timestamp}${random}`;
  }
  
  // Set SLA targets based on priority
  if (!this.sla.resolutionTime.target) {
    const slaTargets = {
      'Critical': 4,   // 4 hours
      'High': 24,      // 24 hours
      'Medium': 72,    // 72 hours
      'Low': 168       // 168 hours (1 week)
    };
    
    this.sla.resolutionTime.target = slaTargets[this.priority];
    this.sla.responseTime.target = Math.min(4, slaTargets[this.priority] / 4);
  }
  
  next();
});

// Post-save middleware to calculate SLA compliance
complaintSchema.post('save', function(doc) {
  if (doc.status === 'Resolved' && doc.resolution?.resolvedAt) {
    const resolutionTimeHours = Math.floor(
      (doc.resolution.resolvedAt - doc.createdAt) / (1000 * 60 * 60)
    );
    
    doc.sla.resolutionTime.actual = resolutionTimeHours;
    doc.sla.resolutionTime.met = resolutionTimeHours <= doc.sla.resolutionTime.target;
  }
});

// Static method to get complaint statistics
complaintSchema.statics.getComplaintStats = function(userId = null) {
  const matchStage = userId ? { user: new mongoose.Types.ObjectId(userId) } : {};
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        open: { $sum: { $cond: [{ $eq: ['$status', 'Open'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
        resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } },
        closed: { $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] } },
        avgResolutionTime: {
          $avg: {
            $cond: [
              { $ne: ['$resolution.resolvedAt', null] },
              { $divide: [{ $subtract: ['$resolution.resolvedAt', '$createdAt'] }, 1000 * 60 * 60] },
              null
            ]
          }
        }
      }
    }
  ]);
};

// Static method to get category distribution
complaintSchema.statics.getCategoryStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        avgPriority: { $avg: { $cond: [
          { $eq: ['$priority', 'Critical'] }, 4,
          { $cond: [
            { $eq: ['$priority', 'High'] }, 3,
            { $cond: [
              { $eq: ['$priority', 'Medium'] }, 2, 1
            ]}
          ]}
        ]}}
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// Indexes for performance
complaintSchema.index({ user: 1, createdAt: -1 });
complaintSchema.index({ status: 1 });
complaintSchema.index({ priority: 1 });
complaintSchema.index({ category: 1 });
complaintSchema.index({ assignedTo: 1 });
complaintSchema.index({ createdAt: -1 });

export const Complaint = mongoose.model('Complaint', complaintSchema);

// Default export for compatibility with default imports
export default Complaint;
