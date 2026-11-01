import mongoose from "mongoose";
const { Schema } = mongoose;
const id = { type: Schema.Types.ObjectId, required: true, index: true };
const model = (name, fields, indexes = []) => {
  const schema = new Schema(fields, { timestamps: true, strict: "throw" });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.model(name, schema);
};
export const Workspace = model("Workspace", {
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  revision: { type: Number, default: 0 },
  settings: {
    type: Schema.Types.Mixed,
    default: () => ({
      timezone: "Asia/Kolkata",
      businessHours: {
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:00",
        holidays: [],
      },
      publicPortal: true,
      statuses: [
        "Open",
        "In Progress",
        "Waiting on customer",
        "Resolved",
        "Closed",
      ],
      pauseStatuses: ["Waiting on customer"],
      customFields: [],
      sla: {
        firstResponse: 240,
        nextResponse: 240,
        resolution: 1440,
        businessHours: true,
      },
      language: "en",
    }),
  },
  billing: {
    plan: { type: String, default: "Free" },
    seats: { type: Number, default: 2 },
    subscriptionId: String,
    expiresAt: Date,
    status: String,
    provider: String,
  },
  ssoEnabled: { type: Boolean, default: false },
  aiAutomation: { type: Boolean, default: false },
});
export const Membership = model(
  "WorkspaceMembership",
  {
    workspace: id,
    user: { ...id, ref: "User" },
    email: { type: String, required: true },
    name: String,
    role: {
      type: String,
      enum: ["owner", "admin", "agent", "analyst", "customer"],
      required: true,
    },
    active: { type: Boolean, default: true },
    capacity: { type: Number, default: 5 },
    online: { type: Boolean, default: true },
    groups: { type: [String], default: ["General"] },
    skills: [String],
    customRole: Schema.Types.ObjectId,
    entitlementSuspended: { type: Boolean, default: false },
  },
  [[{ workspace: 1, user: 1 }, { unique: true }]],
);
export const Invitation = model("WorkspaceInvitation", {
  workspace: id,
  email: String,
  role: String,
  tokenHash: { type: String, unique: true },
  expiresAt: Date,
  acceptedAt: Date,
  invitedBy: id,
});
export const Contact = model(
  "WorkspaceContact",
  {
    workspace: id,
    name: String,
    email: { type: String, required: true },
    phone: String,
    company: String,
    notes: String,
    tags: [String],
  },
  [[{ workspace: 1, email: 1 }, { unique: true }]],
);
export const Ticket = model(
  "WorkspaceTicket",
  {
    workspace: id,
    number: { type: String, required: true },
    subject: String,
    description: String,
    contact: { ...id, ref: "WorkspaceContact" },
    status: { type: String, default: "Open" },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },
    channel: {
      type: String,
      enum: [
        "web",
        "chat",
        "email",
        "whatsapp",
        "phone",
        "instagram",
        "messenger",
      ],
      default: "web",
    },
    group: { type: String, default: "General" },
    tags: [String],
    customFields: Schema.Types.Mixed,
    assignedTo: { type: Schema.Types.ObjectId, ref: "WorkspaceMembership" },
    mergedInto: Schema.Types.ObjectId,
    version: { type: Number, default: 0 },
    guest: { type: Boolean, default: false },
    guestVerified: { type: Boolean, default: false },
    emailVerifyHash: { type: String, select: false },
    emailVerifyExpires: Date,
    emailVerifySentAt: Date,
    guestTokenHash: { type: String, select: false },
    externalThread: String,
    connection: Schema.Types.ObjectId,
    sla: {
      policy: Schema.Types.Mixed,
      lastBreachKey: String,
      firstDue: Date,
      nextDue: Date,
      resolutionDue: Date,
      firstRespondedAt: Date,
      resolvedAt: Date,
      pausedAt: Date,
      remaining: Schema.Types.Mixed,
      breached: { type: Boolean, default: false },
    },
    automationRuns: [String],
    legacyId: { type: Schema.Types.ObjectId },
    aiAnsweredAt: Date,
  },
  [
    [{ workspace: 1, number: 1 }, { unique: true }],
    [
      { workspace: 1, legacyId: 1 },
      {
        unique: true,
        partialFilterExpression: { legacyId: { $type: "objectId" } },
      },
    ],
    [{ workspace: 1, status: 1, createdAt: -1 }, {}],
  ],
);
export const Message = model(
  "WorkspaceMessage",
  {
    workspace: id,
    ticket: id,
    author: String,
    authorRole: String,
    text: String,
    internal: { type: Boolean, default: false },
    attachments: [Schema.Types.ObjectId],
    externalId: String,
    connection: Schema.Types.ObjectId,
    delivery: { type: String, default: "stored" },
  },
  [
    [
      { workspace: 1, connection: 1, externalId: 1 },
      {
        unique: true,
        partialFilterExpression: { externalId: { $type: "string" } },
      },
    ],
  ],
);
export const Article = model(
  "WorkspaceArticle",
  {
    workspace: id,
    slug: String,
    title: String,
    body: String,
    category: String,
    language: { type: String, default: "en" },
    published: { type: Boolean, default: false },
    author: id,
  },
  [[{ workspace: 1, slug: 1 }, { unique: true }]],
);
export const Resource = model("WorkspaceResource", {
  workspace: id,
  kind: {
    type: String,
    enum: ["canned", "macro", "view", "automation", "sla"],
    required: true,
  },
  name: String,
  value: Schema.Types.Mixed,
  active: { type: Boolean, default: true },
  author: id,
});
export const Connector = model("WorkspaceConnector", {
  workspace: id,
  kind: {
    type: String,
    enum: [
      "email",
      "whatsapp",
      "slack",
      "shopify",
      "shiprocket",
      "webhook",
      "phone",
      "instagram",
      "messenger",
    ],
    required: true,
  },
  name: String,
  enabled: { type: Boolean, default: true },
  secret: { type: String, select: false },
  token: { type: String, select: false },
  verifyTokenHash: { type: String, select: false },
  config: Schema.Types.Mixed,
});
export const Job = model("WorkspaceJob", {
  workspace: id,
  kind: String,
  payload: Schema.Types.Mixed,
  key: { type: String, unique: true },
  attempts: { type: Number, default: 0 },
  availableAt: { type: Date, default: Date.now },
  lockedUntil: Date,
  leaseToken: String,
  state: { type: String, default: "queued" },
  lastError: String,
});
export const Attachment = model("WorkspaceAttachment", {
  workspace: id,
  ticket: id,
  name: String,
  mime: String,
  size: Number,
  internal: { type: Boolean, default: false },
  storageKey: { type: String, select: false },
  sha256: String,
  uploadedBy: id,
});
export const Audit = model("WorkspaceAudit", {
  workspace: id,
  actor: String,
  action: String,
  target: String,
  detail: Schema.Types.Mixed,
});

export const Presence = model(
  "WorkspacePresence",
  {
    workspace: id,
    ticket: id,
    member: { ...id, ref: "WorkspaceMembership" },
    expiresAt: Date,
  },
  [
    [{ workspace: 1, ticket: 1, member: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
);

export const ApiKey = model("WorkspaceApiKey", {
  workspace: id,
  member: id,
  name: String,
  scopes: [String],
  prefix: String,
  hash: { type: String, unique: true, select: false },
  expiresAt: Date,
  revokedAt: Date,
});

export const CustomRole = model(
  "WorkspaceCustomRole",
  { workspace: id, name: String, permissions: [String] },
  [[{ workspace: 1, name: 1 }, { unique: true }]],
);
export const Dashboard = model("WorkspaceDashboard", {
  workspace: id,
  member: id,
  name: String,
  widgets: [String],
  days: { type: Number, default: 30 },
});
export const SecurityProfile = model("SecurityProfile", {
  user: { ...id, unique: true },
  enabled: { type: Boolean, default: false },
  secret: { type: String, select: false },
  pendingSecret: { type: String, select: false },
  pendingExpires: Date,
  lastCounter: Number,
  recoveryHashes: { type: [String], select: false },
  version: { type: Number, default: 0 },
});
export const AuthFlow = model(
  "AuthFlow",
  {
    hash: { type: String, unique: true },
    kind: String,
    user: Schema.Types.ObjectId,
    workspace: Schema.Types.ObjectId,
    payload: Schema.Types.Mixed,
    expiresAt: Date,
  },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
);
export const SSOIdentity = model(
  "SSOIdentity",
  { workspace: id, user: id, issuer: String, subject: String },
  [[{ workspace: 1, issuer: 1, subject: 1 }, { unique: true }]],
);
export const Embedding = model(
  "WorkspaceEmbedding",
  {
    workspace: id,
    article: id,
    chunk: Number,
    text: String,
    model: String,
    hash: String,
    vector: { type: [Number], select: false },
  },
  [[{ workspace: 1, article: 1, chunk: 1 }, { unique: true }]],
);
export const AIEvaluation = model("WorkspaceAIEvaluation", {
  workspace: id,
  ticket: Schema.Types.ObjectId,
  question: String,
  answer: String,
  sources: [Schema.Types.ObjectId],
  mode: String,
  supported: Boolean,
  score: Number,
  feedback: String,
  actor: String,
});
export const BillingOrder = model("WorkspaceBillingOrder", {
  workspace: id,
  orderId: { type: String, unique: true },
  paymentId: { type: String, unique: true, sparse: true },
  receipt: { type: String, unique: true },
  invoiceNumber: { type: String, unique: true, sparse: true },
  plan: String,
  seats: Number,
  net: Number,
  tax: Number,
  total: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  currency: { type: String, default: "INR" },
  status: { type: String, default: "created" },
  customer: Schema.Types.Mixed,
  seller: Schema.Types.Mixed,
  taxRate: Number,
  paidAt: Date,
  expiresAt: Date,
  applied: { type: Boolean, default: false },
});
export const WorkerHeartbeat = model("HelpdeskWorkerHeartbeat", {
  name: { type: String, unique: true },
  lastSeen: Date,
  lastError: String,
});

export const ChannelIdentity = model(
  "WorkspaceChannelIdentity",
  {
    workspace: id,
    connector: id,
    externalCustomer: String,
    contact: id,
    verifiedBy: id,
  },
  [[{ workspace: 1, connector: 1, externalCustomer: 1 }, { unique: true }]],
);

export const InvoiceSequence = model("WorkspaceInvoiceSequence", {
  _id: String,
  value: { type: Number, default: 0 },
});
