import { createRequire } from "node:module";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let reviewPage;
async function main() {
  const uploads = await mkdtemp(
    path.join(os.tmpdir(), "quickfix-audit-uploads-"),
  );
  process.env.PRIVATE_UPLOAD_DIR = uploads;
  const mongo = await MongoMemoryReplSet.create({
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
  process.env.MONGODB_URI = mongo.getUri();
  process.env.JWT_SECRET =
    "browser-fixture-secret-more-than-thirty-two-characters";
  process.env.PORT = "5105";
  process.env.FRONTEND_URL = "http://localhost:5175";
  process.env.VITE_API_URL = "http://localhost:5105/api";
  process.env.VITE_API_BASE_URL = "http://localhost:5105/api";
  process.env.VITE_SOCKET_SERVER_URL = "http://localhost:5105";
  process.env.NODE_ENV = "test";
  process.env.INTEGRATION_ENCRYPTION_KEY = "5".repeat(64);
  await mongoose.connect(process.env.MONGODB_URI);
  const { User } = await import("../../src/models/User.js");
  const { Workspace, Membership, Article, Resource, Ticket } =
    await import("../../src/helpdesk/models.js");
  const { inWorkspace } = await import("../../src/helpdesk/access.js");
  const { createTicket } = await import("../../src/helpdesk/tickets.js");
  await Promise.all(
    Object.values(mongoose.models).map((Model) => Model.init()),
  );
  const user = await User.create({
    name: "Gourav Pandey",
    email: "gourav@fixture.invalid",
    password: "Fixture-password-123!",
    isVerified: true,
  });
  const workspace = await Workspace.create({
    name: "VaidikTalk Support",
    slug: "vaidiktalk-demo",
  });
  await Membership.create({
    workspace: workspace._id,
    user: user._id,
    email: user.email,
    name: user.name,
    role: "owner",
  });
  const tickets = [];
  for (const [subject, description, priority] of [
    [
      "Delivery update for order #VT-1042",
      "My order has been in transit for three days. Could you check the latest update?",
      "High",
    ],
    [
      "Bracelet care instructions",
      "How should I clean and store my bracelet safely?",
      "Medium",
    ],
    [
      "Request to update delivery address",
      "Please help me update my address before the parcel is dispatched.",
      "Medium",
    ],
  ])
    tickets.push(
      (
        await inWorkspace(workspace._id, (session, current) =>
          createTicket(
            current,
            {
              email: "customer@fixture.invalid",
              name: "Aditi Sharma",
              subject,
              description,
              priority,
            },
            user._id,
            session,
          ),
        )
      ).ticket,
    );
  await Ticket.insertMany(
    Array.from({ length: 31 }, (_, index) => ({
      workspace: workspace._id,
      contact: tickets[0].contact,
      number: `QF-BROWSER-PAGE-${index}`,
      subject: `Phone pagination fixture ${index}`,
      description: "Phone channel pagination regression",
      channel: "phone",
    })),
  );
  await Ticket.updateOne(
    { _id: tickets[0]._id },
    { $set: { channel: "email" } },
  );
  await Article.create({
    workspace: workspace._id,
    slug: "track-your-order",
    title: "How to track your order",
    body: "You can track your order using the tracking link in your dispatch notification. If the latest update is delayed, contact our support team with your order number.",
    category: "Orders and delivery",
    published: true,
    author: user._id,
  });
  await Resource.create({
    workspace: workspace._id,
    kind: "canned",
    name: "Delivery acknowledgement",
    value: {
      text: "Thank you for sharing your order details. We are checking the latest delivery update and will get back to you.",
    },
    author: user._id,
  });
  const { BillingOrder } = await import("../../src/helpdesk/models.js");
  await BillingOrder.create({
    workspace: workspace._id,
    orderId: "order_browserfixture",
    paymentId: "pay_browserfixture",
    receipt: "QF-BROWSER-RECEIPT",
    invoiceNumber: "QF2627/000001",
    plan: "Pro",
    seats: 2,
    net: 10000,
    tax: 1800,
    total: 11800,
    taxRate: 1800,
    status: "paid",
    paidAt: new Date(),
    customer: {
      name: "Fixture Buyer",
      address: "Fixture customer address",
      stateCode: "20",
      stateName: "Jharkhand",
    },
    seller: {
      name: "<b>Fixture Seller</b>",
      address: "Fixture seller address",
      gstin: "20AAAAA0000A1Z5",
      stateCode: "20",
      stateName: "Jharkhand",
      sac: "998314",
    },
  });
  await import("../../src/server.js");
  process.chdir(new URL("../../../frontend", import.meta.url).pathname);
  const { createServer } =
    await import("../../../frontend/node_modules/vite/dist/node/index.js");
  const vite = await createServer({
    root: new URL("../../../frontend", import.meta.url).pathname,
    server: { port: 5175, host: "127.0.0.1" },
  });
  await vite.listen();
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  reviewPage = page;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (r) => {
    if (r.url().startsWith("http://localhost:5105/api/") && r.status() >= 500)
      errors.push(`Unexpected API ${r.status()}: ${new URL(r.url()).pathname}`);
  });
  const access = jwt.sign(
    { id: String(user._id), tokenType: "access", issuedAt: Date.now() + 1 },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  await page.addInitScript(
    ({ access, user }) => {
      // Seed once so MFA verification can replace the session across reloads.
      if (!sessionStorage.getItem("token"))
        sessionStorage.setItem("token", access);
      if (!sessionStorage.getItem("user"))
        sessionStorage.setItem("user", JSON.stringify(user));
    },
    {
      access,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: "user",
        firstName: "Gourav",
        lastName: "Pandey",
      },
    },
  );
  await page.goto("http://localhost:5175/dashboard");
  await page.waitForURL("**/workspaces");
  await page.getByRole("button", { name: /Reject all/i }).click();
  await page
    .getByRole("heading", { name: "Operations overview", exact: true })
    .waitFor();
  await page.screenshot({
    path: "/tmp/quickfix-operations-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page
    .getByRole("heading", { name: "Support inbox", exact: true })
    .waitFor();
  await page
    .getByLabel("Filter channel", { exact: true })
    .selectOption("phone");
  await page.getByText("1–30 of 31", { exact: true }).waitFor();
  const firstPhonePage = await page
    .getByRole("button", { name: /Phone pagination fixture/ })
    .allTextContents();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("31–31 of 31", { exact: true }).waitFor();
  const lastPhoneTicket = await page
    .getByRole("button", { name: /Phone pagination fixture/ })
    .textContent();
  if (firstPhonePage.includes(lastPhoneTicket))
    throw new Error("Ticket duplicated across inbox pages");
  await page
    .getByLabel("Search tickets", { exact: true })
    .fill("no matching ticket");
  await page.getByText("0 tickets", { exact: true }).waitFor();
  await page.getByLabel("Filter channel", { exact: true }).selectOption("");
  await page
    .getByLabel("Search tickets", { exact: true })
    .fill("Delivery update for order");
  await page
    .getByRole("button", { name: "Table and bulk actions", exact: true })
    .click();
  await page
    .getByLabel("Search table tickets", { exact: true })
    .fill("Delivery update for order");
  await page
    .getByRole("button", {
      name: "Delivery update for order #VT-1042",
      exact: false,
    })
    .waitFor();
  await page.getByLabel("Select all page tickets", { exact: true }).check();
  await page
    .getByLabel("Bulk ticket priority", { exact: true })
    .selectOption("High");
  await page
    .getByRole("button", { name: "Apply to selected", exact: true })
    .click();
  await page.getByText("Selected tickets updated.", { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: "Delivery update for order #VT-1042",
      exact: false,
    })
    .click();
  await page.getByRole("button", { name: /Delivery update for order/ }).click();
  await page
    .getByRole("heading", {
      name: "Delivery update for order #VT-1042",
      level: 2,
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: "/tmp/quickfix-helpdesk-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Format email reply", { exact: true }).check();
  await page
    .getByRole("textbox", { name: "Formatted reply", exact: true })
    .fill("We are checking the latest shipment update for you.");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await page.getByText("Reply saved.", { exact: true }).waitFor();
  const { Message } = await import("../../src/helpdesk/models.js");
  const savedReply = await Message.findOne({
    ticket: tickets[0]._id,
    text: "We are checking the latest shipment update for you.",
  });
  if (!savedReply?.html) throw new Error("Formatted reply HTML was not saved");
  await page
    .getByRole("button", { name: "Advanced setup", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Advanced service setup", exact: true })
    .waitFor();
  for (const [section, heading] of [
    ["Calling", "Browser calling and call routing"],
    ["WhatsApp", "WhatsApp template approvals"],
    ["Identity", "SAML and user provisioning"],
    ["Recurring billing", "Recurring payments / UPI AutoPay"],
    ["Accounting", "Reviewed invoices and credit notes"],
    ["AI evaluation", "AI acceptance checks"],
    ["Service health", "Service health"],
  ]) {
    await page
      .getByRole("navigation", {
        name: "Advanced service sections",
        exact: true,
      })
      .getByRole("button", { name: section, exact: true })
      .click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    if (section === "Calling") {
      await page
        .getByRole("checkbox", {
          name: "Route incoming calls to available browser agents",
        })
        .check();
      await page
        .getByRole("checkbox", { name: "Transcribe live conversations" })
        .check();
    }
    if (section === "Accounting")
      await page
        .getByRole("heading", {
          name: "GST e-invoice registration",
          exact: true,
        })
        .waitFor();
  }
  await page.screenshot({
    path: "/tmp/quickfix-advanced-setup.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Knowledge base", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Company knowledge", exact: true })
    .waitFor();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Email support verification guide");
  await page
    .getByLabel("Article content", { exact: true })
    .fill(
      "Use the six-digit OTP emailed to you to verify your support conversation.",
    );
  await page
    .getByRole("checkbox", { name: "Publish to the customer help centre" })
    .check();
  const articleSaved = page.waitForResponse(
    (r) => r.url().endsWith("/articles") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save article", exact: true }).click();
  if ((await articleSaved).status() !== 201)
    throw new Error("Knowledge article creation failed");
  await page
    .getByRole("button", {
      name: "Email support verification guide",
      exact: false,
    })
    .waitFor();
  await page.screenshot({
    path: "/tmp/quickfix-helpdesk-knowledge.png",
    fullPage: true,
  });
  for (const [tab, heading] of [
    ["Customers", "Customer directory"],
    ["Tools", "Agent productivity"],
    ["Team", "Invite your support team"],
    ["Connections", "Connected channels"],
    ["Billing", "Workspace billing"],
    ["Reports", "Support performance"],
    ["Channels", "Support channels"],
    ["AI studio", "AI studio"],
    ["Migration", "Import existing complaints"],
    ["Readiness", "Deployment readiness"],
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "Service hours and SLAs", exact: true })
    .waitFor();
  await page.screenshot({
    path: "/tmp/quickfix-helpdesk-settings.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "India billing", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Indian billing", exact: true })
    .waitFor();
  const invoiceDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download printable invoice", exact: true })
    .click();
  const invoice = await invoiceDownload,
    invoiceText = await readFile(await invoice.path(), "utf8");
  if (
    !invoiceText.includes("&lt;b&gt;Fixture Seller&lt;/b&gt;") ||
    invoiceText.includes("<b>Fixture Seller</b>")
  )
    throw new Error("Invoice content is not escaped");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page
    .getByLabel("Search tickets", { exact: true })
    .fill("Delivery update for order");
  await page.getByRole("button", { name: /Delivery update for order/ }).click();
  await page
    .getByRole("heading", {
      name: "Delivery update for order #VT-1042",
      level: 2,
      exact: true,
    })
    .waitFor();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile layout overflows horizontally");
  await page.screenshot({
    path: "/tmp/quickfix-helpdesk-mobile.png",
    fullPage: true,
  });
  const guest = await browser.newPage({
    viewport: { width: 1000, height: 900 },
  });
  guest.on("pageerror", (error) => errors.push(error.message));
  reviewPage = guest;
  await guest.goto("http://localhost:5175/support/vaidiktalk-demo");
  await guest.getByRole("button", { name: /Reject all/i }).click();
  await guest
    .getByRole("button", { name: "How to track your order", exact: false })
    .waitFor();
  await guest.screenshot({
    path: "/tmp/quickfix-help-centre.png",
    fullPage: true,
  });

  await guest
    .getByRole("button", { name: "Contact support", exact: true })
    .click();
  await guest.getByLabel("Your name", { exact: true }).fill("Email Customer");
  await guest
    .getByLabel("Email", { exact: true })
    .fill("email-customer@example.com");
  await guest
    .getByLabel("Subject", { exact: true })
    .fill("Email OTP verification test");
  await guest
    .getByLabel("Tell us what happened", { exact: true })
    .fill("Please help me track this order using email support.");
  const pendingResponse = guest.waitForResponse(
    (r) =>
      r.url().endsWith("/help/vaidiktalk-demo/tickets") &&
      r.request().method() === "POST",
  );
  await guest
    .getByRole("button", { name: "Submit support request", exact: true })
    .click();
  const pendingResult = await pendingResponse;
  const pending = await pendingResult.json();
  if (pendingResult.status() !== 201)
    throw new Error("Portal request failed: " + JSON.stringify(pending));
  if (pending.accessToken)
    throw new Error("Unverified portal response leaked access");
  await guest
    .getByRole("heading", { name: "Verify your email OTP", exact: true })
    .waitFor();
  const { Job } = await import("../../src/helpdesk/models.js");
  const { decrypt } = await import("../../src/helpdesk/connectors.js");
  const otpJob = await Job.findOne({
    kind: "customer.email-otp",
    "payload.ticket": new mongoose.Types.ObjectId(pending.id),
  });
  await guest
    .getByLabel("Email OTP", { exact: true })
    .fill(decrypt(otpJob.payload.code));
  await guest
    .getByRole("button", {
      name: "Verify OTP and open conversation",
      exact: true,
    })
    .click();
  await guest
    .getByText("Please help me track this order using email support.", {
      exact: false,
    })
    .waitFor();

  const { Attachment } = await import("../../src/helpdesk/models.js");
  const fixture = Buffer.from("%PDF-1.4 Public customer document");
  await writeFile(path.join(uploads, "public-document"), fixture);
  const shared = await Attachment.create({
    workspace: workspace._id,
    ticket: pending.id,
    name: "support-guide.pdf",
    mime: "application/pdf",
    size: fixture.length,
    storageKey: "public-document",
    internal: false,
    uploadedBy: user._id,
  });
  await Message.create({
    workspace: workspace._id,
    ticket: pending.id,
    author: String(user._id),
    authorRole: "agent",
    text: "Your requested support guide.",
    internal: false,
    attachments: [shared._id],
  });
  const fileDownload = guest.waitForEvent("download");
  await guest
    .getByRole("button", { name: "Download support-guide.pdf", exact: true })
    .click();
  const downloaded = await fileDownload;
  if (!(await readFile(await downloaded.path())).equals(fixture))
    throw new Error("Shared customer attachment did not download correctly");
  await guest.screenshot({
    path: "/tmp/quickfix-email-otp-verified.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page
    .getByRole("heading", { name: "Account security", exact: true })
    .waitFor();
  const enrollmentResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/security/mfa/enroll") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const enrollment = await (await enrollmentResponse).json();
  const { totp } = await import("../../src/helpdesk/security.js");
  await page
    .getByLabel("Confirm authenticator code", { exact: true })
    .fill(totp(enrollment.secret));
  const confirmResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/security/mfa/confirm") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm MFA", exact: true }).click();
  const confirmation = await (await confirmResponse).json();
  await page
    .getByRole("heading", {
      name: "Save these recovery codes now",
      exact: true,
    })
    .waitFor();
  await page.evaluate(
    (access) => sessionStorage.setItem("token", access),
    access,
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Verify your sign-in", exact: true })
    .waitFor();
  await page
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill(confirmation.recoveryCodes[0]);
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Operations overview", exact: true })
    .waitFor();
  console.log(
    "BROWSER_REVIEW",
    JSON.stringify({
      pageErrors: errors,
      replySaved: true,
      publicHelpCentre: true,
    }),
  );
  await writeFile(
    "/tmp/quickfix-browser-review.json",
    JSON.stringify({ errors, replySaved: true, publicHelpCentre: true }),
  );
  await browser.close();
  await vite.close();
  await mongoose.disconnect();
  await mongo.stop();
  await rm(uploads, { recursive: true, force: true });
  if (errors.length) throw new Error(errors.join("\n"));
}
main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    await reviewPage
      ?.screenshot({
        path: "/tmp/quickfix-browser-failure.png",
        fullPage: true,
      })
      .catch(() => {});
    console.error(error);
    process.exit(1);
  });
