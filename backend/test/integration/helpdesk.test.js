import analyticsEnterprise from "../../src/helpdesk/analytics.js";
import {
  securityRoutes,
  enterpriseSecurityRoutes,
  totp,
  base32,
} from "../../src/helpdesk/security.js";
import indiaBillingEnterprise, {
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
  app.use(express.json());
  app.use((req, res, next) => {
    req.cookies = {};
    next();
  });
  app.use(
    "/workspaces",
    routes,
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
    assert.ok((await result.text()).includes("<Dial>+919000000002</Dial>"));
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
