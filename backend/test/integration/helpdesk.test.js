import eInvoiceRoutes from "../../src/helpdesk/einvoicing.js";
import { voiceDeskAdmin } from "../../src/helpdesk/voiceDesk.js";
import {
  VoiceDesk,
  VoiceUtterance,
  ProvisionGroup,
  EInvoiceSubmission,
} from "../../src/helpdesk/models.js";
import analyticsEnterprise from "../../src/helpdesk/analytics.js";
import productivity from "../../src/helpdesk/productivity.js";
import { voiceAdmin, voicePublic } from "../../src/helpdesk/voicePlus.js";
import { scimAdmin, scimRoutes } from "../../src/helpdesk/scim.js";
import { samlAdmin, samlPublic } from "../../src/helpdesk/saml.js";
import whatsappPlus from "../../src/helpdesk/whatsappPlus.js";
import evaluationRoutes, {
  runBenchmark,
} from "../../src/helpdesk/evaluation.js";
import accountingRoutes from "../../src/helpdesk/accounting.js";
import recurringRoutes, {
  recurringEvent,
} from "../../src/helpdesk/recurring.js";
import { operationsAdmin } from "../../src/helpdesk/operationsPlus.js";
import { mailOAuthAdmin } from "../../src/helpdesk/mailOAuth.js";
import { mailboxAccessToken } from "../../src/helpdesk/mailAuth.js";
import {
  AccountingDocument,
  RecurringPlan,
  AIBenchmark,
  VoiceCall,
  ProvisionUser,
} from "../../src/helpdesk/models.js";
import { encrypt, decrypt } from "../../src/helpdesk/connectors.js";
import {
  securityRoutes,
  enterpriseSecurityRoutes,
  totp,
  base32,
} from "../../src/helpdesk/security.js";
import indiaBillingEnterprise, {
  razorpayWebhook,
  applyPayment,
  amounts,
  secureHex,
} from "../../src/helpdesk/indiaBilling.js";
import mailboxEnterprise, {
  importRawMail,
} from "../../src/helpdesk/mailbox.js";
import {
  semanticRoutes,
  publicAIRoutes,
  indexKnowledge,
  semanticSearch,
  faqAnswer,
} from "../../src/helpdesk/semantic.js";
import migrationEnterprise from "../../src/helpdesk/migration.js";
import {
  channelAdmin,
  socialRoutes,
  voiceRoutes,
} from "../../src/helpdesk/omnichannel.js";
import {
  reconcileSeats,
  seatAllowed,
} from "../../src/helpdesk/entitlements.js";
import {
  SecurityProfile,
  CustomRole,
  BillingOrder,
  Embedding,
  AIEvaluation,
  Attachment,
} from "../../src/helpdesk/models.js";
import { Complaint } from "../../src/models/Complaint.js";
import twilio from "twilio";
import { keyRoutes, developerRoutes } from "../../src/helpdesk/developer.js";
import commerceRoutes from "../../src/helpdesk/commerce.js";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { User } from "../../src/models/User.js";
import {
  Workspace,
  Membership,
  Invitation,
  Ticket,
  Message,
  Article,
  Resource,
  Connector,
  Job,
  Contact,
} from "../../src/helpdesk/models.js";
import routes from "../../src/helpdesk/routes.js";
import portal from "../../src/helpdesk/portal.js";
import {
  connectorRoutes,
  channelRoutes,
} from "../../src/helpdesk/connectors.js";
import {
  billingRoutes,
  processWorkspaceCheckout,
  syncWorkspaceSubscription,
} from "../../src/helpdesk/billing.js";
import attachments from "../../src/helpdesk/attachments.js";
import aiRoutes from "../../src/helpdesk/ai.js";
import { checkSLAs, drainJobs } from "../../src/helpdesk/jobs.js";
import anthropic from "../../src/services/anthropicService.js";
process.env.JWT_SECRET = "helpdesk-integration-secret-at-least-32-characters";
process.env.INTEGRATION_ENCRYPTION_KEY = "2".repeat(64);
process.env.STRIPE_WORKSPACE_PRO_PRICE_ID = "price_fixture_pro";
let mongo, server, base, alice, bob, carol, a, b;
const token = (user) =>
  jwt.sign(
    { id: String(user._id), tokenType: "access", issuedAt: Date.now() + 1 },
    process.env.JWT_SECRET,
  );
const call = (user, path, method = "GET", body, headers = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const body = async (response) => {
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
};
const createWorkspace = async (user, name) =>
  body(
    await call(user, "/workspaces", "POST", { name, slug: name.toLowerCase() }),
  );
const createTicket = async (user, workspace, subject = "Delivery issue") =>
  body(
    await call(user, `/workspaces/${workspace._id}/tickets`, "POST", {
      subject,
      description: "The order has not been delivered.",
      email: user.email,
    }),
  );
const invite = async (owner, workspace, user, role) => {
  const result = await body(
    await call(owner, `/workspaces/${workspace._id}/invites`, "POST", {
      email: user.email,
      role,
    }),
  );
  return call(user, "/workspaces/invites/accept", "POST", {
    token: result.token,
  });
};
before(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: {
      count: 1,
      args: [
        "--nounixsocket",
        "--setParameter",
        "diagnosticDataCollectionEnabled=false",
      ],
    },
  });
  await mongoose.connect(mongo.getUri());
  await Promise.all(
    Object.values(mongoose.models).map((Model) => Model.init()),
  );
  const app = express();
  app.use("/channels", channelRoutes);
  app.use("/social", socialRoutes);
  app.use("/voice", voiceRoutes);
  app.use("/razorpay", razorpayWebhook);
  app.use("/voice-plus", voicePublic);
  app.use(express.json());
  app.use((req, res, next) => {
    req.cookies = {};
    next();
  });
  app.use(
    "/workspaces",
    routes,
    productivity,
    voiceAdmin,
    voiceDeskAdmin,
    eInvoiceRoutes,
    scimAdmin,
    samlAdmin,
    whatsappPlus,
    accountingRoutes,
    recurringRoutes,
    evaluationRoutes,
    operationsAdmin,
    mailOAuthAdmin,
    connectorRoutes,
    billingRoutes,
    attachments,
    aiRoutes,
    keyRoutes,
    commerceRoutes,
  );
  app.use(
    "/workspaces",
    analyticsEnterprise,
    enterpriseSecurityRoutes,
    indiaBillingEnterprise,
    mailboxEnterprise,
    semanticRoutes,
    migrationEnterprise,
    channelAdmin,
  );
  app.use("/security", securityRoutes);
  app.use("/developer", developerRoutes);
  app.use("/scim", scimRoutes);
  app.use("/sso", samlPublic);
  app.use("/help", publicAIRoutes, portal);
  app.use((error, req, res, next) =>
    res.status(error.statusCode || 400).json({ error: error.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  for (const Model of Object.values(mongoose.models))
    await Model.deleteMany({});
  [alice, bob, carol] = await Promise.all(
    ["Alice", "Bob", "Carol"].map((name) =>
      User.create({
        name,
        email: name.toLowerCase() + "@example.com",
        password: "Fixture-password-123!",
        isVerified: true,
      }),
    ),
  );
  a = await createWorkspace(alice, "Alpha");
  b = await createWorkspace(bob, "Bravo");
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test("workspace membership is required even for a known ID and unrelated data never appears", async () => {
  const ticket = await createTicket(alice, a);
  for (const path of [
    `/workspaces/${a._id}`,
    `/workspaces/${a._id}/tickets`,
    `/workspaces/${a._id}/tickets/${ticket._id}`,
    `/workspaces/${a._id}/reports`,
  ])
    assert.equal((await call(bob, path)).status, 404);
  const list = await body(await call(bob, `/workspaces/${b._id}/tickets`));
  assert.equal(list.total, 0);
  assert.equal(
    (await call(alice, `/workspaces/${b._id}/tickets/${ticket._id}`)).status,
    404,
  );
});
test("invites are email-bound, single-use and staff seats are enforced transactionally", async () => {
  const invitation = await body(
    await call(alice, `/workspaces/${a._id}/invites`, "POST", {
      email: carol.email,
      role: "agent",
    }),
  );
  assert.equal(
    (
      await call(bob, "/workspaces/invites/accept", "POST", {
        token: invitation.token,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(carol, "/workspaces/invites/accept", "POST", {
        token: invitation.token,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(carol, "/workspaces/invites/accept", "POST", {
        token: invitation.token,
      })
    ).status,
    404,
  );
  assert.equal((await invite(alice, a, bob, "agent")).status, 409);
  assert.equal((await invite(alice, a, bob, "customer")).status, 200);
  const own = await Membership.findOne({ workspace: a._id, user: alice._id });
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/members/${own._id}`, "PATCH", {
        active: false,
      })
    ).status,
    409,
  );
});
test("customers see only their tickets and cannot create notes or impersonate customer email", async () => {
  await invite(alice, a, carol, "customer");
  const privateTicket = await createTicket(alice, a);
  const customerTicket = await body(
    await call(carol, `/workspaces/${a._id}/tickets`, "POST", {
      subject: "My order",
      description: "Please investigate my order",
      email: alice.email,
    }),
  );
  const contact = await Contact.findById(customerTicket.contact);
  assert.equal(contact.email, carol.email);
  assert.equal(
    (await call(carol, `/workspaces/${a._id}/tickets/${privateTicket._id}`))
      .status,
    404,
  );
  await call(
    alice,
    `/workspaces/${a._id}/tickets/${customerTicket._id}/messages`,
    "POST",
    { text: "Private note", internal: true },
  );
  const detail = await body(
    await call(carol, `/workspaces/${a._id}/tickets/${customerTicket._id}`),
  );
  assert.ok(detail.messages.every((message) => !message.internal));
  assert.equal(
    (
      await call(
        carol,
        `/workspaces/${a._id}/tickets/${customerTicket._id}/messages`,
        "POST",
        { text: "hide", internal: true },
      )
    ).status,
    403,
  );
});
test("knowledge base publishing and public guest conversations preserve privacy", async () => {
  await call(alice, `/workspaces/${a._id}/articles`, "POST", {
    slug: "delivery",
    title: "Delivery times",
    body: "Orders usually arrive within five working days.",
    published: true,
  });
  await call(alice, `/workspaces/${a._id}/articles`, "POST", {
    slug: "private",
    title: "Internal policy",
    body: "This is a confidential draft policy.",
    published: false,
  });
  const articles = await body(await call(null, "/help/alpha/articles"));
  assert.equal(articles.length, 1);
  const created = await body(
    await call(null, "/help/alpha/tickets", "POST", {
      name: "Guest",
      email: "guest@example.com",
      subject: "Please help",
      description: "I need assistance with delivery.",
    }),
  );
  assert.equal(
    (await call(null, `/help/alpha/tickets/${created.id}`)).status,
    404,
  );
  const detail = await body(
    await call(null, `/help/alpha/tickets/${created.id}`, "GET", undefined, {
      "X-Ticket-Token": created.accessToken,
    }),
  );
  assert.equal(detail.messages.length, 1);
  assert.equal(
    (
      await call(null, `/help/bravo/tickets/${created.id}`, "GET", undefined, {
        "X-Ticket-Token": created.accessToken,
      })
    ).status,
    404,
  );
});
test("macros, automation, saved views, custom fields and collision checks operate inside a workspace", async () => {
  await body(
    await call(alice, `/workspaces/${a._id}`, "PATCH", {
      settings: {
        customFields: [
          { key: "order_id", label: "Order ID", type: "text", required: true },
        ],
      },
    }),
  );
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/tickets`, "POST", {
        subject: "Missing field",
        description: "No order ID",
        email: alice.email,
      })
    ).status,
    400,
  );
  await body(
    await call(alice, `/workspaces/${a._id}/resources/automation`, "POST", {
      name: "Prioritize delivery",
      value: {
        event: "ticket.created",
        conditions: [
          { field: "subject", operator: "contains", value: "delivery" },
        ],
        actions: { priority: "High" },
      },
    }),
  );
  const ticket = await body(
    await call(alice, `/workspaces/${a._id}/tickets`, "POST", {
      subject: "Delivery failed",
      description: "Please check delivery",
      email: alice.email,
      customFields: { order_id: "ORDER-12" },
    }),
  );
  assert.equal(ticket.priority, "High");
  const macro = await body(
    await call(alice, `/workspaces/${a._id}/resources/macro`, "POST", {
      name: "Start investigation",
      value: {
        actions: {
          status: "In Progress",
          reply: "We are investigating your order.",
        },
      },
    }),
  );
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/tickets/${ticket._id}/macros/${macro._id}`,
      "POST",
      {},
    ),
  );
  assert.equal((await Ticket.findById(ticket._id)).status, "In Progress");
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/tickets/${ticket._id}`, "PATCH", {
        status: "Closed",
        expectedVersion: 0,
      })
    ).status,
    409,
  );
  const view = await body(
    await call(alice, `/workspaces/${a._id}/resources/view`, "POST", {
      name: "Urgent delivery",
      value: { priority: "High" },
    }),
  );
  const list = await body(
    await call(alice, `/workspaces/${a._id}/tickets?view=${view._id}`),
  );
  assert.equal(list.total, 1);
});
test("inbox pagination, personal queues and social-channel saved views preserve workspace scope", async () => {
  const first = await createTicket(alice, a);
  const member = await Membership.findOne({
    workspace: a._id,
    user: alice._id,
  });
  await Ticket.updateOne({ _id: first._id }, { $set: { assignedTo: null } });
  // Equal timestamps reproduce unstable offset pagination unless ID is a tie-breaker.
  const timestamp = new Date();
  const rows = Array.from({ length: 34 }, (_, index) => ({
    workspace: a._id,
    contact: first.contact,
    number: `QF-PAGE-${index}`,
    subject: `Inbox ticket ${index}`,
    description: "Pagination regression",
    channel: ["phone", "instagram", "messenger"][index % 3],
    assignedTo: index % 2 ? member._id : null,
    updatedAt: timestamp,
    createdAt: timestamp,
  }));
  await Ticket.insertMany(rows);
  await createTicket(bob, b);
  const path = `/workspaces/${a._id}`;
  const firstPage = await body(await call(alice, `${path}/tickets?limit=30`));
  const secondPage = await body(
    await call(alice, `${path}/tickets?limit=30&page=2`),
  );
  assert.equal(firstPage.total, 35);
  assert.equal(firstPage.limit, 30);
  assert.equal(secondPage.tickets.length, 5);
  assert.equal(
    new Set([...firstPage.tickets, ...secondPage.tickets].map((t) => t._id))
      .size,
    35,
  );
  const mine = await body(await call(alice, `${path}/tickets?mine=true`));
  assert.equal(mine.total, 17);
  assert.ok(mine.tickets.every((t) => t.assignedTo._id === String(member._id)));
  const unassignedMine = await body(
    await call(alice, `${path}/tickets?mine=true&bucket=unassigned`),
  );
  assert.equal(unassignedMine.total, 0);
  for (const channel of ["phone", "instagram", "messenger"]) {
    const saved = await body(
      await call(alice, `${path}/resources/view`, "POST", {
        name: `${channel} queue`,
        value: { channel },
      }),
    );
    const result = await body(
      await call(alice, `${path}/tickets?view=${saved._id}`),
    );
    assert.ok(result.total > 0);
    assert.ok(result.tickets.every((t) => t.channel === channel));
  }
  assert.equal((await call(alice, `${path}/tickets?page=0`)).status, 400);
  assert.equal(
    (await call(alice, `${path}/tickets?channel=unknown`)).status,
    400,
  );
});
test("merging refuses unrelated customers and moves only same-workspace conversations", async () => {
  const first = await createTicket(alice, a),
    second = await createTicket(alice, a, "Another delivery issue");
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/tickets/${first._id}/merge`,
      "POST",
      { target: second._id },
    ),
  );
  assert.equal(
    String((await Ticket.findById(first._id)).mergedInto),
    second._id,
  );
  assert.equal(await Message.countDocuments({ ticket: second._id }), 2);
  const foreign = await createTicket(bob, b);
  assert.equal(
    (
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${second._id}/merge`,
        "POST",
        { target: foreign._id },
      )
    ).status,
    404,
  );
});
test("signed incoming email creates tickets, threads replies and deduplicates retries", async () => {
  const connection = await body(
    await call(alice, `/workspaces/${a._id}/connectors`, "POST", {
      kind: "email",
      name: "Support email",
    }),
  );
  const send = async (messageId, description, signature = true) => {
    const raw = JSON.stringify({
        messageId,
        threadId: "email-thread-1",
        email: "buyer@example.com",
        subject: "Order delivery",
        description,
      }),
      sig =
        "sha256=" +
        crypto
          .createHmac("sha256", connection.webhookSecret)
          .update(raw)
          .digest("hex");
    return fetch(`${base}/channels/${connection.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QuickFix-Signature": signature ? sig : "bad",
      },
      body: raw,
    });
  };
  assert.equal((await send("mail-1", "First message", false)).status, 401);
  assert.equal((await send("mail-1", "First message")).status, 200);
  assert.equal((await send("mail-1", "First message")).status, 200);
  assert.equal((await send("mail-2", "Second message")).status, 200);
  assert.equal(await Ticket.countDocuments({ workspace: a._id }), 1);
  assert.equal(await Message.countDocuments({ workspace: a._id }), 2);
});
test("SLA maintenance, Slack outbox and retries are scoped and auditable", async () => {
  await body(
    await call(alice, `/workspaces/${a._id}/connectors`, "POST", {
      kind: "slack",
      name: "Support alerts",
      slackUrl: "https://hooks.slack.com/services/T123/B456/token",
    }),
  );
  const ticket = await createTicket(alice, a);
  await Ticket.updateOne(
    { _id: ticket._id },
    { $set: { "sla.firstDue": new Date(Date.now() - 60000) } },
  );
  await checkSLAs();
  await checkSLAs();
  assert.equal((await Ticket.findById(ticket._id)).sla.breached, true);
  assert.equal(
    await Job.countDocuments({ workspace: a._id, kind: "slack" }),
    2,
  );
  let requests = 0;
  await drainJobs(
    {
      fetcher: async (url) => {
        assert.ok(url.startsWith("https://hooks.slack.com/services/"));
        requests++;
        return { ok: true };
      },
    },
    10,
  );
  assert.equal(requests, 2);
  assert.equal(
    await Job.countDocuments({ workspace: a._id, state: "sent" }),
    2,
  );
});
test("AI retrieval uses published articles from this workspace only and keeps human review", async () => {
  const ticket = await createTicket(alice, a);
  await Article.create([
    {
      workspace: a._id,
      slug: "delivery",
      title: "Our delivery policy",
      body: "Delivery takes five working days.",
      published: true,
      author: alice._id,
    },
    {
      workspace: b._id,
      slug: "secret",
      title: "Foreign secret",
      body: "Delivery secret for another business",
      published: true,
      author: bob._id,
    },
  ]);
  const previous = anthropic.chat;
  let prompt = "";
  anthropic.chat = async (value) => {
    prompt = value;
    return { success: true, response: "Please allow five working days [1]." };
  };
  try {
    const result = await body(
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${ticket._id}/ai-draft`,
        "POST",
        { language: "hi" },
      ),
    );
    assert.equal(result.needsHumanReview, true);
    assert.equal(result.sources.length, 1);
    assert.ok(!prompt.includes("Foreign secret"));
  } finally {
    anthropic.chat = previous;
  }
});
test("workspace subscriptions update seat entitlements without using customer plans", async () => {
  const subscription = {
    id: "sub_fixture",
    metadata: { workspaceId: a._id },
    status: "active",
    current_period_end: Math.floor(Date.now() / 1000) + 86400,
    items: { data: [{ price: { id: "price_fixture_pro" }, quantity: 4 }] },
  };
  await processWorkspaceCheckout(
    { subscriptions: { retrieve: async () => subscription } },
    { metadata: { workspaceId: a._id }, subscription: "sub_fixture" },
  );
  let current = await Workspace.findById(a._id);
  assert.equal(current.billing.plan, "Pro");
  assert.equal(current.billing.seats, 4);
  assert.equal((await User.findById(alice._id)).planType, "Free");
  await syncWorkspaceSubscription({ ...subscription, status: "canceled" });
  current = await Workspace.findById(a._id);
  assert.equal(current.billing.plan, "Free");
});
test("SLA policies, pause/resume and staff presence are persisted without leaking across companies", async () => {
  await invite(alice, a, carol, "agent");
  await body(
    await call(alice, `/workspaces/${a._id}/resources/sla`, "POST", {
      name: "Critical response",
      value: {
        conditions: [{ field: "priority", operator: "eq", value: "Critical" }],
        policy: {
          firstResponse: 5,
          nextResponse: 10,
          resolution: 60,
          businessHours: false,
        },
      },
    }),
  );
  const ticket = await body(
    await call(alice, `/workspaces/${a._id}/tickets`, "POST", {
      subject: "Critical outage",
      description: "Please help urgently",
      email: alice.email,
      priority: "Critical",
    }),
  );
  assert.equal(
    (new Date(ticket.sla.firstDue) - new Date(ticket.createdAt)) / 60000 >= 4.9,
    true,
  );
  await body(
    await call(alice, `/workspaces/${a._id}/tickets/${ticket._id}`, "PATCH", {
      status: "Waiting on customer",
      expectedVersion: ticket.version,
    }),
  );
  assert.ok((await Ticket.findById(ticket._id)).sla.pausedAt);
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/tickets/${ticket._id}/presence`,
      "POST",
      {},
    ),
  );
  const viewers = await body(
    await call(
      carol,
      `/workspaces/${a._id}/tickets/${ticket._id}/presence`,
      "POST",
      {},
    ),
  );
  assert.equal(viewers[0].name, "Alice");
  await call(
    alice,
    `/workspaces/${a._id}/tickets/${ticket._id}/messages`,
    "POST",
    { text: "Customer context", internal: false },
  );
  const guest = await body(
    await call(null, "/help/alpha/tickets", "POST", {
      name: "Buyer",
      email: "buyer@example.com",
      subject: "Waiting order",
      description: "Please investigate this order",
    }),
  );
  const current = await Ticket.findById(guest.id);
  await call(alice, `/workspaces/${a._id}/tickets/${guest.id}`, "PATCH", {
    status: "Waiting on customer",
    expectedVersion: current.version,
  });
  await body(
    await call(
      null,
      `/help/alpha/tickets/${guest.id}/messages`,
      "POST",
      { text: "Here is the requested information" },
      { "X-Ticket-Token": guest.accessToken },
    ),
  );
  assert.equal((await Ticket.findById(guest.id)).status, "Open");
  assert.equal((await Ticket.findById(guest.id)).sla.pausedAt, undefined);
});
test("Shopify context matches the ticket customer and provider URLs cannot be redirected by input", async () => {
  const { orderContext } = await import("../../src/helpdesk/commerce.js");
  await body(
    await call(alice, `/workspaces/${a._id}/connectors`, "POST", {
      kind: "shopify",
      name: "Store",
      shopDomain: "alpha.myshopify.com",
      token: "fixture-token",
    }),
  );
  const ticket = await createTicket(alice, a);
  const result = await orderContext(
    a._id,
    ticket,
    { order: "1234" },
    async (url, request) => {
      assert.equal(
        url,
        "https://alpha.myshopify.com/admin/api/2026-07/graphql.json",
      );
      assert.equal(request.headers["X-Shopify-Access-Token"], "fixture-token");
      return {
        ok: true,
        json: async () => ({
          data: {
            orders: {
              nodes: [
                {
                  id: "order-1",
                  name: "#1234",
                  email: alice.email,
                  displayFulfillmentStatus: "FULFILLED",
                  displayFinancialStatus: "PAID",
                  fulfillments: [],
                },
                {
                  id: "order-2",
                  name: "#1234",
                  email: bob.email,
                  fulfillments: [],
                },
              ],
            },
          },
        }),
      };
    },
  );
  assert.equal(result.orders.length, 1);
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/connectors`, "POST", {
        kind: "shopify",
        name: "Bad",
        shopDomain: "127.0.0.1",
        token: "token",
      })
    ).status,
    400,
  );
});
test("guest-created tickets cannot be used to merge and expose an authenticated customer conversation", async () => {
  const real = await createTicket(alice, a),
    guest = await body(
      await call(null, "/help/alpha/tickets", "POST", {
        name: "Impersonator",
        email: alice.email,
        subject: "Unverified email",
        description: "Guest identity has not been verified",
      }),
    );
  assert.equal(
    (
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${real._id}/merge`,
        "POST",
        { target: guest.id },
      )
    ).status,
    409,
  );
});
test("developer API keys enforce workspace binding, action scopes and revocation", async () => {
  const key = await body(
    await call(alice, `/workspaces/${a._id}/api-keys`, "POST", {
      name: "Read-only integration",
      scopes: ["tickets:read"],
    }),
  );
  const request = (path, method = "GET", value) =>
    fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${key.token}`,
        "Content-Type": "application/json",
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
  assert.equal((await request(`/developer/${a._id}/tickets`)).status, 200);
  assert.equal((await request(`/developer/${b._id}/tickets`)).status, 401);
  assert.equal(
    (
      await request(`/developer/${a._id}/tickets`, "POST", {
        subject: "Injected",
        description: "Not allowed",
        email: alice.email,
      })
    ).status,
    403,
  );
  await call(alice, `/workspaces/${a._id}/api-keys/${key.id}`, "DELETE");
  assert.equal((await request(`/developer/${a._id}/tickets`)).status, 401);
});
test("outgoing workspace webhooks sign deliveries without exposing private notes", async () => {
  const connection = await body(
    await call(alice, `/workspaces/${a._id}/connectors`, "POST", {
      kind: "webhook",
      name: "Event receiver",
      webhookUrl: "https://example.com/quickfix-hook",
    }),
  );
  await createTicket(alice, a);
  let delivered;
  await drainJobs(
    {
      webhookSender: async (url, payload, headers) => {
        assert.equal(url, "https://example.com/quickfix-hook");
        assert.equal(
          headers["X-QuickFix-Signature"],
          "sha256=" +
            crypto
              .createHmac("sha256", connection.webhookSecret)
              .update(payload)
              .digest("hex"),
        );
        delivered = JSON.parse(payload);
      },
    },
    10,
  );
  assert.equal(delivered.event, "ticket.created");
  assert.equal(delivered.ticket.status, "Open");
  assert.equal(delivered.messages, undefined);
});
test("concurrent invitations cannot overbook the free workspace staff seats", async () => {
  const invites = await Promise.all(
    [bob, carol].map(async (user) =>
      body(
        await call(alice, `/workspaces/${a._id}/invites`, "POST", {
          email: user.email,
          role: "agent",
        }),
      ),
    ),
  );
  const results = await Promise.all(
    [bob, carol].map((user, index) =>
      call(user, "/workspaces/invites/accept", "POST", {
        token: invites[index].token,
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    await Membership.countDocuments({
      workspace: a._id,
      active: true,
      role: { $ne: "customer" },
    }),
    2,
  );
});
test("attachments require malware scanning and enforce authorization on stored private files", async () => {
  const net = await import("node:net"),
    fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quickfix-private-"));
  process.env.PRIVATE_UPLOAD_DIR = dir;
  const ticket = await createTicket(alice, a),
    file = Buffer.from("%PDF-1.4\nfixture");
  const upload = () =>
    fetch(`${base}/workspaces/${a._id}/tickets/${ticket._id}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token(alice)}`,
        "Content-Type": "application/octet-stream",
        "X-File-Name": "invoice.pdf",
        "X-Attachment-Visibility": "internal",
      },
      body: file,
    });
  delete process.env.CLAMAV_HOST;
  assert.equal((await upload()).status, 503);
  const scanner = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 12 && buffer.subarray(-4).equals(Buffer.alloc(4)))
        socket.end("stream: OK\0");
    });
  });
  scanner.listen(0, "127.0.0.1");
  await new Promise((resolve) => scanner.once("listening", resolve));
  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String(scanner.address().port);
  try {
    await invite(alice, a, carol, "customer");
    const customerTicket = await body(
      await call(carol, `/workspaces/${a._id}/tickets`, "POST", {
        subject: "Private attachment",
        description: "Check private file isolation",
      }),
    );
    await Ticket.updateOne(
      { _id: ticket._id },
      { $set: { contact: customerTicket.contact } },
    );
    const attachment = await body(await upload());
    assert.equal(
      (
        await call(
          carol,
          `/workspaces/${a._id}/tickets/${ticket._id}/attachments/${attachment._id}`,
        )
      ).status,
      404,
    );
    assert.deepEqual(
      await body(
        await call(
          carol,
          `/workspaces/${a._id}/tickets/${ticket._id}/attachments`,
        ),
      ),
      [],
    );
    const response = await call(
      alice,
      `/workspaces/${a._id}/tickets/${ticket._id}/attachments/${attachment._id}`,
    );
    assert.equal(response.status, 200);
    assert.ok(
      response.headers.get("content-disposition").includes("attachment"),
    );
    assert.equal((await response.arrayBuffer()).byteLength, file.length);
    assert.equal(
      (
        await call(
          bob,
          `/workspaces/${b._id}/tickets/${ticket._id}/attachments/${attachment._id}`,
        )
      ).status,
      404,
    );
  } finally {
    delete process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_PORT;
    delete process.env.PRIVATE_UPLOAD_DIR;
    await new Promise((resolve) => scanner.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("guest email proof rotates the original token and cannot be replayed", async () => {
  const guest = await body(
    await call(null, "/help/alpha/tickets", "POST", {
      name: "Buyer",
      email: "buyer@example.com",
      subject: "Verify my request",
      description: "Please help with this order",
    }),
  );
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/tickets/${guest.id}/verify-customer`,
      "POST",
      {},
    ),
  );
  assert.equal(
    (
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${guest.id}/verify-customer`,
        "POST",
        {},
      )
    ).status,
    429,
  );
  let email;
  await drainJobs(
    {
      mailer: {
        sendMail: async (value) => {
          email = value;
        },
      },
    },
    10,
  );
  assert.equal(email.to, "buyer@example.com");
  const link = new URL(email.text.match(/https?:\/\/\S+/)[0]),
    proof = link.searchParams.get("verify");
  const verified = await body(
    await call(null, `/help/alpha/tickets/${guest.id}/verify-email`, "POST", {
      proof,
    }),
  );
  assert.equal(
    (
      await call(null, `/help/alpha/tickets/${guest.id}`, "GET", undefined, {
        "X-Ticket-Token": guest.accessToken,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(null, `/help/alpha/tickets/${guest.id}`, "GET", undefined, {
        "X-Ticket-Token": verified.accessToken,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(null, `/help/alpha/tickets/${guest.id}/verify-email`, "POST", {
        proof,
      })
    ).status,
    404,
  );
  assert.equal((await Ticket.findById(guest.id)).guestVerified, true);
});

test("SLA batches progress past reported breaches and abandoned final deliveries become retryable", async () => {
  const first = await createTicket(alice, a),
    second = await createTicket(alice, a, "Second delayed order");
  await Ticket.updateMany(
    { workspace: a._id },
    { $set: { "sla.firstDue": new Date(Date.now() - 60000) } },
  );
  assert.equal(await checkSLAs(1), 1);
  assert.equal(await checkSLAs(1), 1);
  assert.equal(await checkSLAs(1), 0);
  assert.equal(
    await Ticket.countDocuments({
      _id: { $in: [first._id, second._id] },
      "sla.breached": true,
    }),
    2,
  );
  const job = await Job.create({
    workspace: a._id,
    kind: "slack",
    key: "abandoned-fixture",
    payload: {},
    state: "processing",
    attempts: 5,
    lockedUntil: new Date(Date.now() - 1000),
    availableAt: new Date(),
  });
  await drainJobs({}, 1);
  assert.equal((await Job.findById(job._id)).state, "failed");
});

const upgrade = async (workspace, plan = "Premium", seats = 6) =>
  Workspace.updateOne(
    { _id: workspace._id },
    {
      $set: {
        billing: {
          plan,
          seats,
          status: "active",
          expiresAt: new Date(Date.now() + 86400000),
        },
      },
    },
  );
test("operations metrics ignore other companies, handle missing due dates and filter role data", async () => {
  const first = await createTicket(alice, a);
  await createTicket(bob, b);
  let metrics = await body(
    await call(alice, `/workspaces/${a._id}/operations`),
  );
  assert.equal(metrics.summary.total, 1);
  assert.equal(metrics.summary.overdue, 0);
  await Ticket.updateOne(
    { _id: first._id },
    { $set: { "sla.firstDue": new Date(Date.now() - 60000) } },
  );
  metrics = await body(await call(alice, `/workspaces/${a._id}/operations`));
  assert.equal(metrics.summary.overdue, 1);
  assert.equal(
    (await call(bob, `/workspaces/${a._id}/operations`)).status,
    404,
  );
  assert.equal(
    (await call(alice, `/workspaces/${a._id}/operations?days=900`)).status,
    400,
  );
  const list = await body(
    await call(alice, `/workspaces/${a._id}/tickets?bucket=overdue`),
  );
  assert.equal(list.total, 1);
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/dashboards`, "POST", {
        name: "My dashboard",
        widgets: ["summary", "agents"],
        days: 7,
      })
    ).status,
    402,
  );
  await upgrade(a);
  const dashboard = await body(
    await call(alice, `/workspaces/${a._id}/dashboards`, "POST", {
      name: "Team overview",
      widgets: ["summary", "agents"],
      days: 7,
    }),
  );
  assert.equal(
    (
      await call(
        bob,
        `/workspaces/${b._id}/dashboards/${dashboard._id}`,
        "DELETE",
      )
    ).status,
    404,
  );
});
test("MFA enrollment, recovery, replay resistance and existing sessions are enforced", async () => {
  const enrollment = await body(
    await call(alice, "/security/mfa/enroll", "POST", {}),
  );
  assert.ok(enrollment.qr.startsWith("data:image/png;base64,"));
  const confirmed = await body(
    await call(alice, "/security/mfa/confirm", "POST", {
      code: totp(enrollment.secret),
    }),
  );
  assert.equal(confirmed.recoveryCodes.length, 10);
  assert.equal((await call(alice, `/workspaces/${a._id}`)).status, 403);
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}`, "GET", undefined, {
        Authorization: "Bearer " + confirmed.token,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(alice, "/security/mfa/verify", "POST", {
        code: totp(enrollment.secret),
      })
    ).status,
    401,
  );
  const recovery = confirmed.recoveryCodes[0];
  await body(
    await call(alice, "/security/mfa/verify", "POST", { code: recovery }),
  );
  assert.equal(
    (await call(alice, "/security/mfa/verify", "POST", { code: recovery }))
      .status,
    401,
  );
  assert.equal(
    (await call(alice, "/security/mfa/disable", "POST", { code: "000000" }))
      .status,
    401,
  );
  await body(
    await call(alice, "/security/mfa/disable", "POST", {
      code: confirmed.recoveryCodes[1],
    }),
  );
  assert.equal((await call(alice, `/workspaces/${a._id}`)).status, 200);
});
test("custom restrictions narrow base roles without granting owner access", async () => {
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/roles`, "POST", {
        name: "Read tickets",
        permissions: ["tickets.read"],
      })
    ).status,
    402,
  );
  await upgrade(a);
  await invite(alice, a, carol, "agent");
  const role = await body(
    await call(alice, `/workspaces/${a._id}/roles`, "POST", {
      name: "Read tickets",
      permissions: ["tickets.read"],
    }),
  );
  const member = await Membership.findOne({
    workspace: a._id,
    user: carol._id,
  });
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/roles/assign/${member._id}`,
      "PATCH",
      { roleId: role._id },
    ),
  );
  assert.equal((await call(carol, `/workspaces/${a._id}`)).status, 200);
  assert.equal((await call(carol, `/workspaces/${a._id}/tickets`)).status, 200);
  assert.equal(
    (
      await call(carol, `/workspaces/${a._id}/tickets`, "POST", {
        subject: "Should fail",
        description: "Read only",
        email: carol.email,
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(carol, `/workspaces/${a._id}/operations`)).status,
    403,
  );
  assert.equal(
    (
      await call(
        alice,
        `/workspaces/${a._id}/roles/assign/${member._id}`,
        "PATCH",
        { roleId: String(new mongoose.Types.ObjectId()) },
      )
    ).status,
    404,
  );
});
test("expired plans suspend excess seats immediately and restore them on upgrade", async () => {
  await upgrade(a);
  await invite(alice, a, bob, "agent");
  await invite(alice, a, carol, "agent");
  const member = await Membership.findOne({
      workspace: a._id,
      user: carol._id,
    }),
    ticket = await createTicket(alice, a);
  await Ticket.updateOne(
    { _id: ticket._id },
    { $set: { assignedTo: member._id } },
  );
  await Workspace.updateOne(
    { _id: a._id },
    { $set: { "billing.expiresAt": new Date(Date.now() - 1000) } },
  );
  assert.equal((await call(carol, `/workspaces/${a._id}`)).status, 403);
  const workspace = await Workspace.findById(a._id);
  await reconcileSeats(workspace);
  assert.equal(
    (await Membership.findById(member._id)).entitlementSuspended,
    true,
  );
  assert.equal((await Ticket.findById(ticket._id)).assignedTo, undefined);
  assert.equal((await call(alice, `/workspaces/${a._id}`)).status, 200);
  await upgrade(a);
  await reconcileSeats(await Workspace.findById(a._id));
  assert.equal((await call(carol, `/workspaces/${a._id}`)).status, 200);
});
test("captured INR payments are amount-bound, idempotent and invoice-isolated", async () => {
  const customer = {
      name: "Buyer",
      address: "Fixture address",
      stateCode: "20",
    },
    seller = {
      name: "QuickFix",
      address: "Fixture seller address",
      stateCode: "20",
      gstin: "20AAAAA0000A1Z5",
    };
  const values = amounts(100001, 1800, "20", "20");
  assert.equal(values.cgst + values.sgst, values.tax);
  assert.equal(values.igst, 0);
  assert.equal(amounts(10000, 1800, "20", "19").igst, 1800);
  const row = await BillingOrder.create({
    workspace: a._id,
    orderId: "order_fixture",
    receipt: "QF-TEST",
    plan: "Pro",
    seats: 4,
    ...values,
    taxRate: 1800,
    customer,
    seller,
  });
  const payment = {
    id: "pay_fixture",
    order_id: row.orderId,
    status: "captured",
    amount: row.total,
    currency: "INR",
  };
  await assert.rejects(applyPayment(row, { ...payment, amount: 1 }));
  await assert.rejects(applyPayment(row, { ...payment, status: "authorized" }));
  await applyPayment(row, payment);
  const expires = (await Workspace.findById(a._id)).billing.expiresAt.getTime();
  await applyPayment(row, payment);
  assert.equal(
    (await Workspace.findById(a._id)).billing.expiresAt.getTime(),
    expires,
  );
  assert.equal(
    (await call(bob, `/workspaces/${b._id}/billing/india/invoices/${row._id}`))
      .status,
    404,
  );
  const invoice = await body(
    await call(alice, `/workspaces/${a._id}/billing/india/invoices/${row._id}`),
  );
  assert.equal(invoice.invoiceType, "Tax invoice draft");
  assert.equal(invoice.total, values.total);
  assert.equal(secureHex("secret", "order|payment", "0".repeat(64)), false);
});
test("HTML email becomes plain text and scanner-approved attachments stay private and deduplicated", async () => {
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path"),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "quickfix-mail-"));
  process.env.PRIVATE_UPLOAD_DIR = dir;
  try {
    const connection = await Connector.create({
        workspace: a._id,
        kind: "email",
        name: "Mailbox",
      }),
      raw = Buffer.from(
        "From: Buyer <buyer@example.com>\r\nTo: support@example.com\r\nMessage-ID: <fixture-mail@example.com>\r\nSubject: HTML mail\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=fixture\r\n\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello <strong>support</strong></p><script>alert(1)</script>\r\n--fixture\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=invoice.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
          Buffer.from("%PDF-1.4 fixture").toString("base64") +
          "\r\n--fixture--\r\n",
      );
    await importRawMail(connection, raw, { scanner: async () => {} });
    await importRawMail(connection, raw, { scanner: async () => {} });
    assert.equal(await Ticket.countDocuments({ workspace: a._id }), 1);
    assert.equal(await Message.countDocuments({ workspace: a._id }), 1);
    const message = await Message.findOne({ workspace: a._id });
    assert.ok(message.text.includes("Hello support"));
    assert.ok(!message.text.includes("<script>"));
    assert.equal(await Attachment.countDocuments({ workspace: a._id }), 1);
    assert.equal(message.attachments.length, 1);
  } finally {
    delete process.env.PRIVATE_UPLOAD_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("semantic retrieval filters stale or unpublished articles and rejects unsupported AI answers", async () => {
  await upgrade(a);
  process.env.EMBEDDING_MODEL = "fixture-embedding";
  const article = await Article.create({
    workspace: a._id,
    slug: "care",
    title: "Bracelet care",
    body: "Clean bracelets with a soft cloth. Keep them dry.",
    published: true,
    author: alice._id,
  });
  await Article.create({
    workspace: b._id,
    slug: "foreign",
    title: "Foreign secret",
    body: "Never return this secret",
    published: true,
    author: bob._id,
  });
  const embedder = async (texts) => texts.map(() => [1, 0]);
  await indexKnowledge(a._id, embedder);
  let rows = await semanticSearch(
    await Workspace.findById(a._id),
    "How to clean bracelets?",
    embedder,
  );
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].article), String(article._id));
  let count = 0;
  const answer = await faqAnswer(
    await Workspace.findById(a._id),
    "How to clean bracelets?",
    {
      search: async () => rows,
      chat: async () => ({
        success: true,
        response:
          ++count === 1
            ? JSON.stringify({
                answer: "Use a soft cloth.",
                citations: [1],
                supported: true,
              })
            : JSON.stringify({ supported: true }),
      }),
    },
  );
  assert.equal(answer.handoff, false);
  assert.equal(await AIEvaluation.countDocuments({ workspace: a._id }), 1);
  const invalid = await faqAnswer(
    await Workspace.findById(a._id),
    "How to clean bracelets?",
    {
      search: async () => rows,
      chat: async () => ({
        success: true,
        response: '{"answer":"Invented","citations":[99],"supported":true}',
      }),
    },
  );
  assert.equal(invalid.handoff, true);
  await Article.updateOne(
    { _id: article._id },
    { $set: { body: "Updated policy text" } },
  );
  rows = await semanticSearch(
    await Workspace.findById(a._id),
    "How to clean?",
    embedder,
  );
  assert.equal(rows.length, 0);
  delete process.env.EMBEDDING_MODEL;
});
test("social inboxes verify signatures, asset ownership and provider retry IDs", async () => {
  await upgrade(a);
  const connection = await body(
    await call(alice, `/workspaces/${a._id}/channels`, "POST", {
      kind: "messenger",
      name: "Social inbox",
      assetId: "123456789",
      token: "fixture-token",
      secret: "fixture-secret",
    }),
  );
  const raw = JSON.stringify({
      entry: [
        {
          id: "123456789",
          messaging: [
            {
              sender: { id: "9988776655" },
              message: {
                mid: "social-message-1",
                text: "Please help with my order",
              },
            },
          ],
        },
      ],
    }),
    signature =
      "sha256=" +
      crypto.createHmac("sha256", "fixture-secret").update(raw).digest("hex");
  const send = (sig) =>
    fetch(base + "/social/" + connection.id, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: raw,
    });
  assert.equal((await send("invalid")).status, 401);
  assert.equal((await send(signature)).status, 200);
  assert.equal((await send(signature)).status, 200);
  assert.equal(
    await Ticket.countDocuments({ workspace: a._id, channel: "messenger" }),
    1,
  );
});
test("legacy migration requires record ownership and explicit confirmation and does not duplicate records", async () => {
  const legacy = await Complaint.create({
      user: alice._id,
      title: "Legacy delivery",
      description: "Import this complaint",
      category: "Delivery",
    }),
    foreign = await Complaint.create({
      user: bob._id,
      title: "Private complaint",
      description: "Do not import",
      category: "Delivery",
    });
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/migration/preview`, "POST", {
        ids: [String(foreign._id)],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(alice, `/workspaces/${a._id}/migration/import`, "POST", {
        ids: [String(legacy._id)],
      })
    ).status,
    400,
  );
  await body(
    await call(alice, `/workspaces/${a._id}/migration/import`, "POST", {
      ids: [String(legacy._id)],
      confirmed: true,
    }),
  );
  const duplicate = await body(
    await call(alice, `/workspaces/${a._id}/migration/import`, "POST", {
      ids: [String(legacy._id)],
      confirmed: true,
    }),
  );
  assert.equal(duplicate.results[0].duplicate, true);
  assert.equal(
    await Ticket.countDocuments({ workspace: a._id, legacyId: legacy._id }),
    1,
  );
  assert.ok(await Complaint.exists({ _id: legacy._id }));
});

test("phone callbacks validate Twilio signatures and return routing instructions without placing a test call", async () => {
  await upgrade(a);
  const account = "AC" + "a".repeat(32),
    authToken = "fixture-twilio-auth-token",
    connection = await body(
      await call(alice, `/workspaces/${a._id}/channels`, "POST", {
        kind: "phone",
        name: "Support phone",
        assetId: account,
        token: authToken,
        secret: authToken,
        phoneNumber: "+919000000001",
        forwardTo: "+919000000002",
      }),
    );
  const previous = process.env.BACKEND_URL;
  process.env.BACKEND_URL = base;
  try {
    const params = {
        AccountSid: account,
        CallSid: "CA" + "b".repeat(32),
        From: "+919000000003",
        To: "+919000000001",
      },
      url = base + "/voice/" + connection.id,
      signature = twilio.getExpectedTwilioSignature(authToken, url, params);
    const send = (sig) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": sig,
        },
        body: new URLSearchParams(params),
      });
    assert.equal((await send("bad")).status, 401);
    const result = await send(signature);
    assert.equal(result.status, 200);
    assert.match(await result.text(), /<Dial[^>]*>\+919000000002<\/Dial>/);
    assert.equal((await send(signature)).status, 200);
    assert.equal(
      await Ticket.countDocuments({ workspace: a._id, channel: "phone" }),
      1,
    );
  } finally {
    if (previous === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previous;
  }
});
test("WhatsApp templates use the durable outbox and private attachments cannot be sent", async () => {
  const connection = await body(
      await call(alice, `/workspaces/${a._id}/connectors`, "POST", {
        kind: "whatsapp",
        name: "WhatsApp",
        token: "fixture-token",
        appSecret: "fixture-app-secret",
        phoneNumberId: "123456789",
      }),
    ),
    raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123456789" },
                contacts: [{ profile: { name: "Buyer" } }],
                messages: [
                  {
                    id: "wa-fixture-message",
                    from: "919000000000",
                    type: "text",
                    text: { body: "Hello support" },
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
    signature =
      "sha256=" +
      crypto
        .createHmac("sha256", "fixture-app-secret")
        .update(raw)
        .digest("hex");
  assert.equal(
    (
      await fetch(base + "/channels/" + connection.id, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature,
        },
        body: raw,
      })
    ).status,
    200,
  );
  const ticket = await Ticket.findOne({
    workspace: a._id,
    channel: "whatsapp",
  });
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/tickets/${ticket._id}/whatsapp`,
      "POST",
      {
        template: {
          name: "approved_order_update",
          language: "en",
          parameters: ["Buyer"],
        },
      },
    ),
  );
  let requests = 0;
  await drainJobs(
    {
      fetcher: async (url, request) => {
        requests++;
        const payload = JSON.parse(request.body);
        assert.equal(payload.type, "template");
        assert.equal(payload.to, "919000000000");
        assert.equal(
          payload.template.components[0].parameters[0].text,
          "Buyer",
        );
        return { ok: true };
      },
    },
    10,
  );
  assert.equal(requests, 1);
  const file = await Attachment.create({
    workspace: a._id,
    ticket: ticket._id,
    name: "private.pdf",
    mime: "application/pdf",
    size: 10,
    internal: true,
    storageKey: "not-read",
    uploadedBy: alice._id,
  });
  assert.equal(
    (
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${ticket._id}/whatsapp`,
        "POST",
        { attachmentId: String(file._id) },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${ticket._id}/whatsapp`,
        "POST",
        {
          template: {
            name: "approved_media",
            language: "en",
            headerAttachmentId: String(file._id),
          },
        },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${ticket._id}/whatsapp`,
        "POST",
        {
          template: {
            name: "approved_media",
            language: "en",
            header: "text",
            headerAttachmentId: String(file._id),
          },
        },
      )
    ).status,
    400,
  );
  const fs = await import("node:fs/promises"),
    os = await import("node:os"),
    path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quickfix-wa-")),
    previous = process.env.PRIVATE_UPLOAD_DIR,
    original = globalThis.fetch;
  process.env.PRIVATE_UPLOAD_DIR = dir;
  try {
    await fs.writeFile(
      path.join(dir, "header-fixture"),
      Buffer.from("scanned fixture"),
    );
    const publicFile = await Attachment.create({
      workspace: a._id,
      ticket: ticket._id,
      name: "guide.pdf",
      mime: "application/pdf",
      size: 15,
      internal: false,
      storageKey: "header-fixture",
      uploadedBy: alice._id,
    });
    globalThis.fetch = async (url, options) =>
      String(url).startsWith("https://graph.facebook.com/")
        ? Response.json({ id: "987654321" })
        : original(url, options);
    await body(
      await call(
        alice,
        `/workspaces/${a._id}/tickets/${ticket._id}/whatsapp`,
        "POST",
        {
          template: {
            name: "approved_media",
            language: "en",
            headerAttachmentId: String(publicFile._id),
          },
        },
      ),
    );
    globalThis.fetch = original;
    let sent = false;
    await drainJobs(
      {
        fetcher: async (url, options) => {
          const payload = JSON.parse(options.body);
          assert.equal(
            payload.template.components[0].parameters[0].type,
            "document",
          );
          assert.deepEqual(
            payload.template.components[0].parameters[0].document,
            { id: "987654321", filename: "guide.pdf" },
          );
          sent = true;
          return { ok: true };
        },
      },
      10,
    );
    assert.equal(sent, true);
  } finally {
    globalThis.fetch = original;
    if (previous) process.env.PRIVATE_UPLOAD_DIR = previous;
    else delete process.env.PRIVATE_UPLOAD_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("custom roles enforce normalized workspace IDs and root settings writes", async () => {
  await upgrade(a);
  await invite(alice, a, carol, "admin");
  const role = await body(
      await call(alice, `/workspaces/${a._id}/roles`, "POST", {
        name: "Ticket-only admin",
        permissions: ["tickets.read"],
      }),
    ),
    member = await Membership.findOne({ workspace: a._id, user: carol._id });
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/roles/assign/${member._id}`,
      "PATCH",
      { roleId: role._id },
    ),
  );
  assert.equal(
    (
      await call(
        carol,
        `/workspaces/${String(a._id).toUpperCase()}/tickets`,
        "POST",
        {
          subject: "Forbidden",
          description: "Must not bypass",
          email: carol.email,
        },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(carol, `/workspaces/${a._id}`, "PATCH", {
        settings: { language: "hi" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(carol, `/workspaces/${String(a._id).toUpperCase()}/tickets`))
      .status,
    200,
  );
});
test("an obsolete outbox lease cannot overwrite a delivery claimed by another worker", async () => {
  await body(
    await call(alice, `/workspaces/${a._id}/connectors`, "POST", {
      kind: "slack",
      name: "Alerts",
      slackUrl: "https://hooks.slack.com/services/T/B/token",
    }),
  );
  await createTicket(alice, a);
  const job = await Job.findOne({ workspace: a._id });
  await drainJobs(
    {
      fetcher: async () => {
        await Job.updateOne(
          { _id: job._id },
          { $set: { leaseToken: "replacement-worker", state: "processing" } },
        );
        return { ok: true };
      },
    },
    1,
  );
  const current = await Job.findById(job._id);
  assert.equal(current.leaseToken, "replacement-worker");
  assert.equal(current.state, "processing");
});

test("custom role edits apply immediately and assigned roles cannot be deleted", async () => {
  await upgrade(a);
  await invite(alice, a, carol, "agent");
  const role = await body(
      await call(alice, `/workspaces/${a._id}/roles`, "POST", {
        name: "Temporary reader",
        permissions: ["tickets.read"],
      }),
    ),
    member = await Membership.findOne({ workspace: a._id, user: carol._id });
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/roles/assign/${member._id}`,
      "PATCH",
      { roleId: role._id },
    ),
  );
  assert.equal(
    (await call(alice, `/workspaces/${a._id}/roles/${role._id}`, "DELETE"))
      .status,
    409,
  );
  await body(
    await call(alice, `/workspaces/${a._id}/roles/${role._id}`, "PATCH", {
      permissions: [],
    }),
  );
  assert.equal((await call(carol, `/workspaces/${a._id}/tickets`)).status, 403);
  await body(
    await call(
      alice,
      `/workspaces/${a._id}/roles/assign/${member._id}`,
      "PATCH",
      { roleId: null },
    ),
  );
  assert.equal(
    (await call(alice, `/workspaces/${a._id}/roles/${role._id}`, "DELETE"))
      .status,
    200,
  );
});

test("bulk changes are atomic, version checked, role restricted and workspace bound", async () => {
  const one = await createTicket(alice, a),
    two = await createTicket(alice, a),
    foreign = await createTicket(bob, b),
    path = `/workspaces/${a._id}/tickets/bulk`;
  const send = (tickets) =>
    call(alice, path, "POST", { tickets, actions: { priority: "Critical" } });
  assert.equal(
    (
      await send([
        { id: one._id, version: one.version },
        { id: two._id, version: two.version + 1 },
      ])
    ).status,
    409,
  );
  assert.equal((await Ticket.findById(one._id)).priority, "Medium");
  assert.equal(
    (
      await send([
        { id: one._id, version: one.version },
        { id: foreign._id, version: foreign.version },
      ])
    ).status,
    404,
  );
  assert.equal((await Ticket.findById(one._id)).priority, "Medium");
  assert.equal(
    (
      await body(
        await send([
          { id: one._id, version: one.version },
          { id: two._id, version: two.version },
        ]),
      )
    ).updated,
    2,
  );
  await invite(alice, a, carol, "agent");
  assert.equal(
    (
      await call(carol, path, "POST", {
        tickets: [{ id: one._id, version: one.version }],
        actions: { status: "Closed" },
      })
    ).status,
    403,
  );
});
test("formatted replies store sanitized HTML and canonical plain text", async () => {
  const t = await createTicket(alice, a),
    path = `/workspaces/${a._id}/tickets/${t._id}/messages`;
  const result = await body(
    await call(alice, path, "POST", {
      text: "spoofed fallback",
      html: "<p>Hello <b>customer</b></p><script>steal()</script><img src=x onerror=steal()>",
    }),
  );
  assert.equal(result.text, "Hello customer");
  assert.equal(result.html, "<p>Hello <b>customer</b></p>");
  assert.equal(
    (
      await call(alice, path, "POST", {
        text: "fallback",
        html: "<script>empty()</script>",
      })
    ).status,
    400,
  );
});
test("mail OAuth refresh rotates encrypted credentials and sync state without exposing tokens", async () => {
  process.env.GOOGLE_MAIL_CLIENT_ID = "fixture-client";
  process.env.GOOGLE_MAIL_CLIENT_SECRET = "fixture-secret";
  try {
    const c = await Connector.create({
      workspace: a._id,
      kind: "email",
      name: "OAuth mail",
      config: {
        imap: { host: "imap.gmail.com", user: alice.email },
        oauth: {
          provider: "google",
          refreshToken: encrypt("old-refresh"),
          expiresAt: 0,
        },
      },
      cursor: { validity: "123", uid: 9 },
      lastSyncAt: new Date(),
    });
    const access = await mailboxAccessToken(c, async (url, options) => {
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      assert.equal(options.body.get("refresh_token"), "old-refresh");
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });
    assert.equal(access, "new-access");
    const stored = await Connector.findById(c._id);
    assert.equal(decrypt(stored.config.oauth.refreshToken), "new-refresh");
    assert.equal(stored.cursor.uid, 9);
    const list = await body(
      await call(alice, `/workspaces/${a._id}/connectors`),
    );
    assert.ok(!JSON.stringify(list).includes("refreshToken"));
    assert.ok(!JSON.stringify(list).includes("accessToken"));
  } finally {
    delete process.env.GOOGLE_MAIL_CLIENT_ID;
    delete process.env.GOOGLE_MAIL_CLIENT_SECRET;
  }
});
test("voice grants bind destination to a ticket and reject callback reuse", async () => {
  await upgrade(a);
  const t = await createTicket(alice, a);
  await Contact.updateOne(
    { _id: t.contact },
    { $set: { phone: "919000000003" } },
  );
  const c = await body(
    await call(alice, `/workspaces/${a._id}/channels`, "POST", {
      kind: "phone",
      name: "Browser phone",
      assetId: "AC" + "a".repeat(32),
      token: "fixture-auth",
      secret: "fixture-auth",
      phoneNumber: "+919000000001",
      forwardTo: "+919000000002",
    }),
  );
  await body(
    await call(alice, `/workspaces/${a._id}/connectors/${c.id}/voice`, "PUT", {
      apiKeySid: "SK" + "b".repeat(32),
      apiKeySecret: "fixture-key-secret",
      appSid: "AP" + "c".repeat(32),
      recordCalls: true,
      recordingNotice: "This call is recorded for quality.",
    }),
  );
  const grant = await body(
    await call(
      alice,
      `/workspaces/${a._id}/tickets/${t._id}/voice-token`,
      "POST",
      {},
    ),
  );
  assert.equal(jwt.decode(grant.token).grants.identity, grant.identity);
  const previous = process.env.BACKEND_URL;
  process.env.BACKEND_URL = base;
  try {
    const params = {
        AccountSid: "AC" + "a".repeat(32),
        CallSid: "CA" + "d".repeat(32),
        From: "client:" + grant.identity,
        To: "+19999999999",
      },
      url = base + "/voice-plus/" + c.id + "/dial";
    const send = () =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
            "fixture-auth",
            url,
            params,
          ),
        },
        body: new URLSearchParams(params),
      });
    const response = await send();
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.ok(xml.includes("+919000000003"));
    assert.ok(!xml.includes("+19999999999"));
    assert.equal((await send()).status, 403);
    assert.equal(
      (
        await body(
          await call(alice, `/workspaces/${a._id}/tickets/${t._id}/calls`),
        )
      ).length,
      1,
    );
    assert.equal(
      (await call(bob, `/workspaces/${a._id}/tickets/${t._id}/calls`)).status,
      404,
    );
  } finally {
    if (previous) process.env.BACKEND_URL = previous;
    else delete process.env.BACKEND_URL;
  }
});
test("SCIM provisions agents, rejects global-account linking, requeues deactivated staff and revokes keys", async () => {
  await upgrade(a);
  const key = await body(
    await call(alice, `/workspaces/${a._id}/security/scim-token`, "POST", {}),
  );
  const scim = (path, method = "GET", value) =>
    fetch(base + `/scim/${a._id}/v2` + path, {
      method,
      headers: {
        Authorization: "Bearer " + key.token,
        "Content-Type": "application/scim+json",
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
  const input = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    externalId: "idp-person-1",
    userName: "managed@example.com",
    displayName: "Managed Agent",
    active: true,
  };
  const created = await body(await scim("/Users", "POST", input)),
    binding = await ProvisionUser.findById(created.id),
    member = await Membership.findById(binding.member);
  assert.equal(member.role, "agent");
  assert.equal(
    (
      await body(
        await scim(
          "/Users?filter=" +
            encodeURIComponent('userName eq "managed@example.com"'),
        ),
      )
    ).totalResults,
    1,
  );
  assert.equal(
    (
      await scim("/Users", "POST", {
        ...input,
        externalId: "unrelated",
        userName: bob.email,
      })
    ).status,
    409,
  );
  const t = await createTicket(alice, a);
  await Ticket.updateOne({ _id: t._id }, { $set: { assignedTo: member._id } });
  const updated = await body(
    await scim("/Users/" + created.id, "PATCH", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Replace", path: "active", value: false }],
    }),
  );
  assert.equal(updated.active, false);
  assert.equal((await Ticket.findById(t._id)).assignedTo, undefined);
  await body(
    await call(alice, `/workspaces/${a._id}/security/scim-token`, "POST", {}),
  );
  assert.equal((await scim("/Users")).status, 401);
});
test("accounting issuance is immutable and credits cannot exceed reviewed invoices", async () => {
  const row = await BillingOrder.create({
      workspace: a._id,
      orderId: "order_accounting",
      paymentId: "pay_accounting",
      receipt: "ACCT-FIXTURE",
      invoiceNumber: "QF2627/987654",
      plan: "Pro",
      seats: 1,
      net: 10000,
      tax: 1800,
      total: 11800,
      cgst: 900,
      sgst: 900,
      igst: 0,
      status: "paid",
      paidAt: new Date(),
      seller: { gstin: "20AAAAA0000A1Z5", sac: "998314" },
      customer: { name: "Buyer" },
    }),
    path = `/workspaces/${a._id}/billing/accounting/${row._id}`;
  assert.equal(
    (
      await call(alice, path + "/issue", "POST", {
        accountingReviewed: true,
        eInvoiceRequired: true,
        treatmentNote: "Accounting fixture review",
      })
    ).status,
    409,
  );
  const first = await body(
    await call(alice, path + "/issue", "POST", {
      accountingReviewed: true,
      eInvoiceRequired: false,
      treatmentNote: "Accounting reviewed e-invoice applicability",
    }),
  );
  const replay = await body(
    await call(alice, path + "/issue", "POST", {
      accountingReviewed: true,
      eInvoiceRequired: false,
      treatmentNote: "Second review cannot overwrite",
    }),
  );
  assert.equal(replay._id, first._id);
  await body(
    await call(alice, path + "/credit-note", "POST", {
      amount: 5000,
      reason: "Partial credit approved",
      accountingReviewed: true,
    }),
  );
  assert.equal(
    (
      await call(alice, path + "/credit-note", "POST", {
        amount: 7000,
        reason: "Exceeds remaining amount",
        accountingReviewed: true,
      })
    ).status,
    409,
  );
  assert.equal((await call(bob, path + "/export")).status, 404);
  assert.equal((await AccountingDocument.find({ invoice: row._id })).length, 2);
});
test("recurring captured payments bind invoice, amount and period without replay extension", async () => {
  process.env.RAZORPAY_PRO_PLAN_ID = "plan_fixture";
  try {
    const row = await RecurringPlan.create({
        workspace: a._id,
        requestKey: "recurring-fixture",
        subscriptionId: "sub_fixture",
        plan: "Pro",
        seats: 2,
        total: 11800,
        amount: {
          net: 10000,
          tax: 1800,
          total: 11800,
          cgst: 900,
          sgst: 900,
          igst: 0,
        },
        taxRate: 1800,
        status: "created",
        seller: {
          name: "Fixture Seller",
          gstin: "20AAAAA0000A1Z5",
          stateCode: "20",
        },
        customer: { name: "Buyer", stateCode: "20" },
      }),
      end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const event = {
      event: "subscription.charged",
      payload: {
        subscription: { entity: { id: row.subscriptionId } },
        payment: { entity: { id: "pay_recurring" } },
      },
    };
    let wrong = false;
    const provider = async (path) =>
      path.startsWith("subscriptions/")
        ? {
            id: "sub_fixture",
            quantity: 2,
            plan_id: "plan_fixture",
            status: "active",
            current_end: end,
          }
        : path.startsWith("payments/")
          ? {
              id: "pay_recurring",
              order_id: "order_recurring",
              invoice_id: "inv_fixture",
              status: "captured",
              amount: 11800,
              currency: "INR",
            }
          : {
              subscription_id: wrong ? "sub_other" : "sub_fixture",
              payment_id: "pay_recurring",
              status: "paid",
              amount_paid: 11800,
              currency: "INR",
              billing_end: end,
              billing_start: end - 30 * 86400,
            };
    wrong = true;
    await assert.rejects(
      () => recurringEvent(event, provider),
      /does not match/,
    );
    wrong = false;
    await recurringEvent(event, provider);
    await recurringEvent(event, provider);
    const current = await Workspace.findById(a._id);
    assert.equal(current.billing.subscriptionId, "razorpay:sub_fixture");
    assert.equal(current.billing.expiresAt.getTime(), end * 1000);
    assert.equal(await BillingOrder.countDocuments({ workspace: a._id }), 1);
  } finally {
    delete process.env.RAZORPAY_PRO_PLAN_ID;
  }
});
test("AI evaluation jobs score expected handoff/evidence and do not repeat completed runs", async () => {
  await upgrade(a);
  const row = await body(
    await call(alice, `/workspaces/${a._id}/ai/benchmarks`, "POST", {
      name: "Support acceptance",
      cases: [
        { question: "Please reset my password", handoff: true },
        {
          question: "How to store my bracelet?",
          handoff: false,
          requiredPhrases: ["dry place"],
          sourceIds: ["a".repeat(24)],
        },
      ],
    }),
  );
  let count = 0;
  await runBenchmark(row._id, async (w, question) => {
    count++;
    return question.includes("password")
      ? { handoff: true, sources: [] }
      : {
          handoff: false,
          answer: "Keep it in a dry place.",
          sources: [{ id: "a".repeat(24) }],
        };
  });
  await runBenchmark(row._id, async () => {
    throw new Error("Should not repeat");
  });
  assert.equal(count, 2);
  assert.equal((await AIBenchmark.findById(row._id)).passRate, 1);
});

test("email delivery includes only scanned public files from the same ticket", async () => {
  const t = await createTicket(alice, a),
    foreign = await createTicket(bob, b);
  const file = await Attachment.create({
    workspace: a._id,
    ticket: t._id,
    name: "receipt.pdf",
    mime: "application/pdf",
    size: 12,
    internal: false,
    storageKey: "fixture-receipt",
    sha256: "a".repeat(64),
    uploadedBy: alice._id,
  });
  const hidden = await Attachment.create({
    workspace: a._id,
    ticket: t._id,
    name: "private.pdf",
    mime: "application/pdf",
    size: 12,
    internal: true,
    storageKey: "fixture-private",
    sha256: "b".repeat(64),
    uploadedBy: alice._id,
  });
  const c = await Connector.create({
    workspace: a._id,
    kind: "email",
    name: "Email replies",
    config: { fromAddress: "support@example.com" },
  });
  await Ticket.updateOne(
    { _id: t._id },
    { $set: { connection: c._id, channel: "email" } },
  );
  const path = `/workspaces/${a._id}/tickets/${t._id}/messages`;
  assert.equal(
    (
      await call(alice, path, "POST", {
        text: "Cannot share private file",
        attachments: [String(hidden._id)],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        bob,
        `/workspaces/${b._id}/tickets/${foreign._id}/messages`,
        "POST",
        {
          text: "Cannot share another workspace file",
          attachments: [String(file._id)],
        },
      )
    ).status,
    403,
  );
  const message = await body(
    await call(alice, path, "POST", {
      text: "Your receipt",
      html: "<p>Your <strong>receipt</strong></p>",
      attachments: [String(file._id)],
    }),
  );
  const job = await Job.findOne({ key: "reply:" + message._id });
  let sent;
  const { deliver } = await import("../../src/helpdesk/jobs.js");
  await deliver(job, {
    mailer: {
      sendMail: async (value) => {
        sent = value;
      },
    },
  });
  assert.equal(sent.attachments.length, 1);
  assert.equal(sent.attachments[0].filename, "receipt.pdf");
  assert.ok(sent.html.includes("<strong>receipt</strong>"));
});

test("SAML validates signed assertions and responses and rejects tampering and replay using shared Mongo cache", async () => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path"),
    { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util"),
    { inflateRawSync } = await import("node:zlib"),
    { SignedXml } = await import("xml-crypto"),
    { samlClient } = await import("../../src/helpdesk/saml.js");
  const directory = await mkdtemp(
    path.join(tmpdir(), "quickfix-saml-fixture-"),
  );
  const names = [
      "SAML_ENTRY_POINT",
      "SAML_IDP_ISSUER",
      "SAML_IDP_CERT",
      "SAML_SP_KEY",
      "SAML_SP_CERT",
      "BACKEND_URL",
    ],
    previous = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    await promisify(execFile)("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(directory, "key.pem"),
      "-out",
      path.join(directory, "cert.pem"),
      "-subj",
      "/CN=fixture.invalid",
      "-days",
      "1",
    ]);
    const key = await readFile(path.join(directory, "key.pem"), "utf8"),
      cert = await readFile(path.join(directory, "cert.pem"), "utf8");
    Object.assign(process.env, {
      SAML_ENTRY_POINT: "https://idp.example.com/saml",
      SAML_IDP_ISSUER: "https://idp.example.com",
      SAML_IDP_CERT: cert,
      SAML_SP_KEY: key,
      SAML_SP_CERT: cert,
      BACKEND_URL: "https://support.example.com",
    });
    const client = samlClient(a),
      url = new URL(await client.getAuthorizeUrlAsync("fixture-relay", {})),
      request = inflateRawSync(
        Buffer.from(url.searchParams.get("SAMLRequest"), "base64"),
      ).toString(),
      requestID = /\bID="([^"]+)"/.exec(request)[1];
    const now = new Date().toISOString(),
      before = new Date(Date.now() - 60000).toISOString(),
      after = new Date(Date.now() + 300000).toISOString(),
      recipient = `https://support.example.com/api/sso/saml/${a.slug}/acs`,
      audience = `https://support.example.com/api/sso/saml/${a.slug}/metadata`;
    let xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response_fixture" Version="2.0" IssueInstant="${now}" Destination="${recipient}" InResponseTo="${requestID}"><saml:Issuer>https://idp.example.com</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assertion_fixture" Version="2.0" IssueInstant="${now}"><saml:Issuer>https://idp.example.com</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">fixture-subject</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestID}" Recipient="${recipient}" NotOnOrAfter="${after}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${before}" NotOnOrAfter="${after}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now}" SessionIndex="fixture-session"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`;
    const sign = (value, element) => {
      const signature = new SignedXml({
        privateKey: key,
        publicCert: cert,
        canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
        signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      });
      signature.addReference({
        xpath: `//*[local-name(.)='${element}']`,
        digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
        transforms: [
          "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
          "http://www.w3.org/2001/10/xml-exc-c14n#",
        ],
      });
      signature.computeSignature(value, {
        location: {
          reference: `//*[local-name(.)='${element}']/*[local-name(.)='Issuer']`,
          action: "after",
        },
      });
      return signature.getSignedXml();
    };
    xml = sign(sign(xml, "Assertion"), "Response");
    await assert.rejects(() =>
      client.validatePostResponseAsync({
        SAMLResponse: Buffer.from(
          xml.replace("fixture-subject", "tampered-subject"),
        ).toString("base64"),
      }),
    );
    // A failed signature must not consume the legitimate request ID.
    const validated = await client.validatePostResponseAsync({
      SAMLResponse: Buffer.from(xml).toString("base64"),
    });
    assert.equal(validated.profile.nameID, "fixture-subject");
    await assert.rejects(() =>
      samlClient(a).validatePostResponseAsync({
        SAMLResponse: Buffer.from(xml).toString("base64"),
      }),
    );
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("cumulative Razorpay refunds revoke only the currently paid recurring entitlement", async () => {
  const saved = [
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
    ].map((k) => [k, process.env[k]]),
    original = globalThis.fetch;
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: "fixture-key",
    RAZORPAY_KEY_SECRET: "fixture-secret",
    RAZORPAY_WEBHOOK_SECRET: "fixture-webhook",
  });
  try {
    await BillingOrder.create({
      workspace: a._id,
      recurringId: "sub_refundfixture",
      orderId: "order_refundfixture",
      paymentId: "pay_refundfixture",
      receipt: "REFUND-FIXTURE",
      plan: "Pro",
      seats: 2,
      total: 11800,
      status: "paid",
      applied: true,
    });
    await Workspace.updateOne(
      { _id: a._id },
      {
        $set: {
          billing: {
            plan: "Pro",
            seats: 2,
            status: "active",
            subscriptionId: "razorpay:sub_refundfixture",
            paymentId: "pay_refundfixture",
            expiresAt: new Date(Date.now() + 86400000),
          },
        },
      },
    );
    globalThis.fetch = async (url, options) =>
      String(url).startsWith("https://api.razorpay.com/")
        ? new Response(
            JSON.stringify({
              id: "pay_refundfixture",
              amount: 11800,
              currency: "INR",
              amount_refunded: 11800,
              status: "refunded",
            }),
            { status: 200 },
          )
        : original(url, options);
    const raw = JSON.stringify({
        event: "refund.processed",
        payload: {
          refund: { entity: { payment_id: "pay_refundfixture", amount: 6000 } },
        },
      }),
      signature = crypto
        .createHmac("sha256", "fixture-webhook")
        .update(raw)
        .digest("hex");
    const response = await original(base + "/razorpay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signature,
      },
      body: raw,
    });
    assert.equal(response.status, 200);
    assert.equal((await Workspace.findById(a._id)).billing.plan, "Free");
    await Workspace.updateOne(
      { _id: a._id },
      {
        $set: {
          billing: {
            plan: "Premium",
            seats: 4,
            status: "active",
            subscriptionId: "razorpay:sub_new",
            paymentId: "pay_new",
            expiresAt: new Date(Date.now() + 86400000),
          },
        },
      },
    );
    await original(base + "/razorpay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signature,
      },
      body: raw,
    });
    assert.equal((await Workspace.findById(a._id)).billing.plan, "Premium");
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
test("SCIM group CRUD scopes member references and preserves manual routing groups", async () => {
  await upgrade(a);
  await upgrade(b);
  const key = await body(
    await call(alice, `/workspaces/${a._id}/security/scim-token`, "POST", {}),
  );
  const scim = (path, method = "GET", value) =>
    fetch(base + `/scim/${a._id}/v2` + path, {
      method,
      headers: {
        Authorization: "Bearer " + key.token,
        "Content-Type": "application/scim+json",
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
  const user = await body(
    await scim("/Users", "POST", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: "group-agent",
      userName: "groups@example.com",
      displayName: "Group Agent",
    }),
  );
  const binding = await ProvisionUser.findById(user.id);
  const group = await body(
    await scim("/Groups", "POST", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      displayName: "Delivery",
      externalId: "idp-delivery",
      members: [{ value: user.id }],
    }),
  );
  let member = await Membership.findById(binding.member);
  assert.deepEqual([...member.groups], ["General"]);
  assert.deepEqual([...member.scimGroups], ["Delivery"]);
  assert.equal(member.role, "agent");
  assert.equal((await body(await scim("/ResourceTypes"))).totalResults, 2);
  assert.equal(
    (
      await body(
        await scim(
          "/Groups?filter=" +
            encodeURIComponent('externalId eq "idp-delivery"'),
        ),
      )
    ).totalResults,
    1,
  );
  assert.equal(
    (
      await scim("/Groups", "POST", {
        schemas: [],
        displayName: "Invalid",
        members: [{ value: String(new mongoose.Types.ObjectId()) }],
      })
    ).status,
    400,
  );
  const patch = (value) =>
    scim("/Groups/" + group.id, "PATCH", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: value,
    });
  await body(
    await patch([{ op: "Replace", path: "displayName", value: "Returns" }]),
  );
  assert.deepEqual(
    [...(await Membership.findById(binding.member)).scimGroups],
    ["Returns"],
  );
  await body(
    await patch([{ op: "Remove", path: `members[value eq "${user.id}"]` }]),
  );
  assert.deepEqual(
    [...(await Membership.findById(binding.member)).scimGroups],
    [],
  );
  await body(
    await patch([
      {
        op: "Add",
        path: "members",
        value: [{ value: user.id }, { value: user.id }],
      },
    ]),
  );
  assert.equal((await ProvisionGroup.findById(group.id)).members.length, 1);
  assert.equal((await scim("/Groups/" + group.id, "DELETE")).status, 204);
  member = await Membership.findById(binding.member);
  assert.deepEqual([...member.scimGroups], []);
  assert.deepEqual([...member.groups], ["General"]);
  assert.equal(
    (
      await fetch(base + `/scim/${b._id}/v2/Groups`, {
        headers: { Authorization: "Bearer " + key.token },
      })
    ).status,
    401,
  );
});
test("browser phone leases route signed inbound calls and final transcripts remain private and deduplicated", async () => {
  await upgrade(a);
  const c = await body(
    await call(alice, `/workspaces/${a._id}/channels`, "POST", {
      kind: "phone",
      name: "Desk",
      assetId: "AC" + "a".repeat(32),
      token: "fixture-auth",
      secret: "fixture-auth",
      phoneNumber: "+919000000001",
      forwardTo: "+919000000002",
    }),
  );
  await body(
    await call(alice, `/workspaces/${a._id}/connectors/${c.id}/voice`, "PUT", {
      apiKeySid: "SK" + "b".repeat(32),
      apiKeySecret: "fixture-secret",
      appSid: "AP" + "c".repeat(32),
      browserInbound: true,
      liveTranscription: true,
      recordingNotice: "This conversation is transcribed for customer support.",
    }),
  );
  const lease = await body(
    await call(alice, `/workspaces/${a._id}/voice/desk`, "POST", {}),
  );
  const decoded = jwt.decode(lease.token);
  assert.equal(decoded.grants.voice.incoming.allow, true);
  assert.equal(decoded.grants.voice.outgoing, undefined);
  assert.equal(
    (await call(alice, `/workspaces/${a._id}/voice/desk`, "POST", {})).status,
    409,
  );
  await body(
    await call(alice, `/workspaces/${a._id}/voice/desk`, "POST", {
      sessionId: lease.sessionId,
    }),
  );
  const prev = process.env.BACKEND_URL;
  process.env.BACKEND_URL = base;
  const sid = "CA" + "d".repeat(32),
    account = "AC" + "a".repeat(32);
  const signed = (path, params) => {
    const url = base + path;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
          "fixture-auth",
          url,
          params,
        ),
      },
      body: new URLSearchParams(params),
    });
  };
  try {
    const response = await signed("/voice/" + c.id, {
      AccountSid: account,
      CallSid: sid,
      From: "+919000000003",
      To: "+919000000001",
    });
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.ok(xml.includes("<Client"));
    assert.ok(xml.includes(lease.identity));
    assert.ok(xml.includes("<Transcription"));
    assert.ok(xml.includes("ticketId"));
    const record = await VoiceCall.findOne({ callSid: sid });
    assert.ok(record.deskMember);
    assert.equal(record.transcriptionEnabled, true);
    const params = {
      AccountSid: account,
      CallSid: sid,
      TranscriptionSid: "GT" + "e".repeat(32),
      TranscriptionEvent: "transcription-content",
      Final: "true",
      SequenceId: "1",
      Track: "inbound_track",
      TranscriptionData: JSON.stringify({
        transcript: "Where is my order?",
        confidence: 0.99,
      }),
    };
    assert.equal(
      (await signed("/voice-plus/" + c.id + "/live-transcription", params))
        .status,
      204,
    );
    assert.equal(
      (await signed("/voice-plus/" + c.id + "/live-transcription", params))
        .status,
      204,
    );
    assert.equal(await VoiceUtterance.countDocuments({ call: record._id }), 1);
    await signed("/voice-plus/" + c.id + "/live-transcription", {
      ...params,
      Final: "false",
      SequenceId: "2",
    });
    assert.equal(await VoiceUtterance.countDocuments({ call: record._id }), 1);
    const path = `/workspaces/${a._id}/tickets/${record.ticket}/calls/${record._id}/transcript`;
    assert.equal(
      (await body(await call(alice, path)))[0].text,
      "Where is my order?",
    );
    assert.equal((await call(bob, path)).status, 404);
    assert.equal(
      (
        await fetch(base + "/voice-plus/" + c.id + "/live-transcription", {
          method: "POST",
          body: new URLSearchParams(params),
        })
      ).status,
      401,
    );
    await signed("/voice-plus/" + c.id + "/desk-status?call=" + sid, {
      AccountSid: account,
      CallSid: "CA" + "f".repeat(32),
      CallStatus: "completed",
    });
    assert.equal(
      (await VoiceDesk.findOne({ workspace: a._id })).currentCall,
      undefined,
    );
    assert.equal(
      (
        await call(alice, `/workspaces/${a._id}/voice/desk`, "DELETE", {
          sessionId: lease.sessionId,
        })
      ).status,
      204,
    );
  } finally {
    if (prev) process.env.BACKEND_URL = prev;
    else delete process.env.BACKEND_URL;
  }
});
test("e-invoice preparation binds immutable totals and environment while missing credentials never mark it submitted", async () => {
  const invoice = await BillingOrder.create({
    workspace: a._id,
    orderId: "order_einvoice",
    receipt: "einvoice",
    invoiceNumber: "QF2627/123456",
    status: "paid",
    paidAt: new Date(),
    currency: "INR",
    plan: "Pro",
    net: 10000,
    cgst: 900,
    sgst: 900,
    igst: 0,
    total: 11800,
    taxRate: 1800,
    seller: {
      gstin: "20AAAAA0000A1Z5",
      stateCode: "20",
      sac: "998314",
      name: "QuickFix",
      address: "Jamshedpur Main Road",
    },
    customer: {
      gstin: "20BBBBB0000B1Z5",
      stateCode: "20",
      name: "Buyer Pvt Ltd",
      address: "Adityapur Main Road",
    },
  });
  const input = {
    seller: { city: "Jamshedpur", pin: 831001 },
    buyer: { city: "Adityapur", pin: 832109 },
    accountingReviewed: true,
  };
  const path = `/workspaces/${a._id}/billing/einvoices`;
  const row = await body(
    await call(alice, path + "/" + invoice._id + "/prepare", "POST", input),
  );
  assert.equal(row.state, "prepared");
  assert.equal(row.payload.ValDtls.TotInvVal, 118);
  assert.equal(row.payload.ItemList[0].GstRt, 18);
  assert.equal(row.payload.DocDtls.No, invoice.invoiceNumber);
  assert.equal(
    (await call(bob, path + "/" + invoice._id + "/prepare", "POST", input))
      .status,
    404,
  );
  assert.equal(
    (
      await call(alice, path + "/" + row._id + "/submit", "POST", {
        payloadHash: row.payloadHash,
        environment: row.environment,
        accountingReviewed: true,
      })
    ).status,
    503,
  );
  assert.equal((await EInvoiceSubmission.findById(row._id)).state, "prepared");
  await EInvoiceSubmission.updateOne(
    { _id: row._id },
    { $set: { state: "outcome-unknown" } },
  );
  assert.equal(
    (await call(alice, path + "/" + invoice._id + "/prepare", "POST", input))
      .status,
    409,
  );
});
