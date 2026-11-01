import express from "express";
import Joi from "joi";
import { stripe } from "../services/stripeClient.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Workspace, Membership } from "./models.js";
import { workspaceAccess, permit, inWorkspace } from "./access.js";
import { validate, fail } from "./validation.js";
export async function syncWorkspaceSubscription(subscription) {
  const workspaceId = subscription.metadata?.workspaceId;
  if (!/^[a-f0-9]{24}$/i.test(workspaceId || "")) return;
  const item = subscription.items?.data?.[0],
    price = item?.price?.id;
  const plan =
    price === process.env.STRIPE_WORKSPACE_PRO_PRICE_ID
      ? "Pro"
      : price === process.env.STRIPE_WORKSPACE_PREMIUM_PRICE_ID
        ? "Premium"
        : null;
  if (!plan) throw fail("Unknown workspace subscription price");
  const seats = item.quantity,
    end = subscription.current_period_end || item.current_period_end;
  if (
    !Number.isInteger(seats) ||
    seats < 1 ||
    seats > 1000 ||
    !Number.isFinite(end)
  )
    throw fail("Invalid subscription entitlement");
  const active = ["active", "trialing"].includes(subscription.status);
  await Workspace.updateOne(
    { _id: workspaceId, "billing.subscriptionId": subscription.id },
    {
      $set: {
        billing: {
          subscriptionId: subscription.id,
          plan: active ? plan : "Free",
          seats: active ? seats : 2,
          expiresAt: new Date(end * 1000),
          status: subscription.status,
        },
      },
    },
  );
}
export async function processWorkspaceCheckout(client, checkout) {
  const workspaceId = checkout.metadata?.workspaceId;
  if (!workspaceId || typeof checkout.subscription !== "string")
    throw fail("Invalid workspace checkout");
  const subscription = await client.subscriptions.retrieve(
    checkout.subscription,
  );
  if (subscription.metadata?.workspaceId !== workspaceId)
    throw fail("Workspace subscription mismatch");
  await inWorkspace(workspaceId, async (session, workspace) => {
    if (
      String(workspace.billing.subscriptionId || "") !== subscription.id &&
      workspace.billing.expiresAt > new Date() &&
      ["active", "trialing"].includes(workspace.billing.status)
    )
      throw fail("Workspace already has an active subscription", 409);
    workspace.billing.subscriptionId = subscription.id;
    await workspace.save({ session });
  });
  await syncWorkspaceSubscription(subscription);
}
export const billingRoutes = express.Router();
billingRoutes.use(authenticate);
billingRoutes.use("/:workspaceId", workspaceAccess);
billingRoutes.get(
  "/:workspaceId/billing",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const used = await Membership.countDocuments({
      workspace: req.workspace._id,
      active: true,
      role: { $ne: "customer" },
    });
    res.json({
      billing: req.workspace.billing,
      usedSeats: used,
      configured: Boolean(stripe && process.env.STRIPE_WORKSPACE_PRO_PRICE_ID),
    });
  }),
);
billingRoutes.post(
  "/:workspaceId/billing/checkout",
  permit("owner"),
  wrap(async (req, res) => {
    if (!stripe) throw fail("Stripe billing is not configured", 503);
    const { plan, seats } = validate(
        Joi.object({
          plan: Joi.string().valid("Pro", "Premium").required(),
          seats: Joi.number().integer().min(1).max(1000).required(),
        }),
        req.body,
      ),
      price = process.env[`STRIPE_WORKSPACE_${plan.toUpperCase()}_PRICE_ID`];
    if (!price)
      throw fail(
        "Configure the recurring workspace price in Stripe first",
        503,
      );
    const used = await Membership.countDocuments({
      workspace: req.workspace._id,
      active: true,
      role: { $ne: "customer" },
    });
    if (seats < used) throw fail("Seat count is below the active staff count");
    if (
      req.workspace.billing.subscriptionId &&
      req.workspace.billing.expiresAt > new Date() &&
      ["active", "trialing"].includes(req.workspace.billing.status)
    )
      throw fail(
        "Manage the active subscription through the billing portal",
        409,
      );
    const metadata = { workspaceId: String(req.workspace._id) },
      origin = new URL(process.env.FRONTEND_URL || "http://localhost:5173")
        .origin;
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: seats }],
      metadata,
      subscription_data: { metadata },
      customer_email: req.user.email,
      success_url: `${origin}/workspaces?checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/workspaces`,
    });
    res.json({ url: checkout.url });
  }),
);
billingRoutes.post(
  "/:workspaceId/billing/verify",
  permit("owner"),
  wrap(async (req, res) => {
    if (!stripe) throw fail("Stripe is not configured", 503);
    const { sessionId } = validate(
        Joi.object({ sessionId: Joi.string().max(200).required() }),
        req.body,
      ),
      checkout = await stripe.checkout.sessions.retrieve(sessionId);
    if (checkout.metadata?.workspaceId !== String(req.workspace._id))
      throw fail("Checkout does not belong to this workspace", 403);
    await processWorkspaceCheckout(stripe, checkout);
    res.json({ success: true });
  }),
);
billingRoutes.post(
  "/:workspaceId/billing/portal",
  permit("owner"),
  wrap(async (req, res) => {
    if (!stripe || !req.workspace.billing.subscriptionId)
      throw fail("No active Stripe subscription", 409);
    const subscription = await stripe.subscriptions.retrieve(
      req.workspace.billing.subscriptionId,
    );
    const customer =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${new URL(process.env.FRONTEND_URL).origin}/workspaces`,
    });
    res.json({ url: session.url });
  }),
);
