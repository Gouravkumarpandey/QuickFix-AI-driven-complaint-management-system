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
  },
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
      enum: ["web", "chat", "email", "whatsapp"],
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
  },
  [
    [{ workspace: 1, number: 1 }, { unique: true }],
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
    enum: ["email", "whatsapp", "slack", "shopify", "shiprocket", "webhook"],
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
