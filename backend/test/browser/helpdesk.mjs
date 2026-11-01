import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let reviewPage;
async function main() {
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
  await mongoose.connect(process.env.MONGODB_URI);
  const { User } = await import("../../src/models/User.js");
  const { Workspace, Membership, Article, Resource } = await import(
    "../../src/helpdesk/models.js"
  );
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
  await import("../../src/server.js");
  process.chdir(new URL("../../../frontend", import.meta.url).pathname);
  const { createServer } = await import(
    "../../../frontend/node_modules/vite/dist/node/index.js"
  );
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
  const access = jwt.sign(
    { id: String(user._id), tokenType: "access", issuedAt: Date.now() + 1 },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  await page.addInitScript(
    ({ access, user }) => {
      sessionStorage.setItem("token", access);
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
  await page.goto("http://localhost:5175/workspaces");
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
  await page.getByRole("button", { name: /Delivery update for order/ }).click();
  await page
    .getByRole("heading", {
      name: "Delivery update for order #VT-1042",
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: "/tmp/quickfix-helpdesk-desktop.png",
    fullPage: true,
  });
  await page
    .getByPlaceholder("Write your response…")
    .fill("We are checking the latest shipment update for you.");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await page.getByText("Reply saved.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Knowledge base", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Company knowledge", exact: true })
    .waitFor();
  await page.screenshot({
    path: "/tmp/quickfix-helpdesk-knowledge.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "Service hours and SLAs", exact: true })
    .waitFor();
  await page.screenshot({
    path: "/tmp/quickfix-helpdesk-settings.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("button", { name: /Delivery update for order/ }).click();
  await page
    .getByRole("heading", {
      name: "Delivery update for order #VT-1042",
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
  await guest.goto("http://localhost:5175/support/vaidiktalk-demo");
  await guest
    .getByRole("button", { name: "How to track your order", exact: false })
    .waitFor();
  await guest.screenshot({
    path: "/tmp/quickfix-help-centre.png",
    fullPage: true,
  });
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
