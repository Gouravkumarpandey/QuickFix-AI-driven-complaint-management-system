import crypto from "node:crypto";
import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Workspace, BillingOrder, InvoiceSequence } from "./models.js";
import {
  workspaceAccess,
  permit,
  inWorkspace,
  objectId,
  audit,
} from "./access.js";
import { reconcileSeats } from "./entitlements.js";
import { validate, fail } from "./validation.js";
export function secureHex(secret, value, signature) {
  if (!/^[a-f0-9]{64}$/.test(signature || "")) return false;
  return crypto.timingSafeEqual(
    Buffer.from(
      crypto.createHmac("sha256", secret).update(value).digest("hex"),
    ),
    Buffer.from(signature),
  );
}
export async function razorpay(
  path,
  { method = "GET", body } = {},
  fetcher = fetch,
) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    throw fail("Razorpay is not configured", 503);
  const response = await fetcher("https://api.razorpay.com/v1/" + path, {
    method,
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET,
        ).toString("base64"),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw fail("Payment provider request failed", 502);
  return response.json();
}
export function amounts(net, rate, sellerState, buyerState) {
  const tax = Math.round((net * rate) / 10000),
    local = sellerState === buyerState;
  return {
    net,
    tax,
    total: net + tax,
    cgst: local ? Math.floor(tax / 2) : 0,
    sgst: local ? tax - Math.floor(tax / 2) : 0,
    igst: local ? 0 : tax,
  };
}
export async function applyPayment(order, payment) {
  if (
    payment.order_id !== order.orderId ||
    payment.status !== "captured" ||
    payment.amount !== order.total ||
    payment.currency !== "INR"
  )
    throw fail("Payment is not captured or does not match this order", 409);
  return inWorkspace(order.workspace, async (session, workspace) => {
    const row = await BillingOrder.findById(order._id).session(session);
    if (row.applied) return row;
    if (
      workspace.billing.subscriptionId &&
      !workspace.billing.subscriptionId.startsWith("razorpay:") &&
      workspace.billing.expiresAt > new Date() &&
      ["active", "trialing"].includes(workspace.billing.status)
    )
      throw fail(
        "An active subscription already exists. Contact billing support for reconciliation.",
        409,
      );
    const start = Math.max(
        Date.now(),
        workspace.billing.expiresAt?.getTime() || 0,
      ),
      expiresAt = new Date(start + 30 * 86400000);
    const today = new Date(),
      year = Number(
        new Intl.DateTimeFormat("en", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
        }).format(today),
      ),
      month = Number(
        new Intl.DateTimeFormat("en", {
          timeZone: "Asia/Kolkata",
          month: "numeric",
        }).format(today),
      ),
      startYear = month >= 4 ? year : year - 1,
      fy = String(startYear).slice(-2) + String(startYear + 1).slice(-2);
    const sequence = await InvoiceSequence.findOneAndUpdate(
      { _id: (row.seller.gstin || "unregistered") + ":" + fy },
      { $inc: { value: 1 } },
      { upsert: true, new: true, session },
    );
    if (sequence.value > 999999)
      throw fail("Invoice series exhausted; configure a new series", 503);
    row.invoiceNumber =
      "QF" + fy + "/" + String(sequence.value).padStart(6, "0");
    row.status = "paid";
    row.paymentId = payment.id;
    row.paidAt = new Date();
    row.expiresAt = expiresAt;
    row.applied = true;
    await row.save({ session });
    workspace.billing = {
      plan: row.plan,
      seats: row.seats,
      provider: "razorpay",
      subscriptionId: "razorpay:" + payment.id,
      expiresAt,
      status: "active",
    };
    await workspace.save({ session });
    await reconcileSeats(workspace, session);
    await audit(workspace._id, "razorpay", "billing.paid", row._id, session, {
      receipt: row.receipt,
    });
    return row;
  });
}
export const razorpayWebhook = express.Router();
razorpayWebhook.post(
  "/",
  express.raw({ type: "application/json", limit: "1mb" }),
  wrap(async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw fail("Webhook not configured", 503);
    if (!secureHex(secret, req.body, req.get("X-Razorpay-Signature")))
      throw fail("Invalid signature", 401);
    const event = JSON.parse(req.body.toString());
    if (["payment.captured", "order.paid"].includes(event.event)) {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        const order = await BillingOrder.findOne({ orderId: payment.order_id });
        if (order)
          await applyPayment(
            order,
            await razorpay("payments/" + encodeURIComponent(payment.id)),
          );
      }
    } else if (event.event === "refund.processed") {
      const refund = event.payload?.refund?.entity,
        order =
          refund?.payment_id &&
          (await BillingOrder.findOne({
            paymentId: refund.payment_id,
            status: "paid",
          }));
      if (order && refund.amount === order.total) {
        await inWorkspace(order.workspace, async (session, workspace) => {
          await BillingOrder.updateOne(
            { _id: order._id, status: "paid" },
            { $set: { status: "refunded" } },
            { session },
          );
          if (
            workspace.billing.subscriptionId ===
            "razorpay:" + order.paymentId
          ) {
            workspace.billing = { plan: "Free", seats: 2, status: "refunded" };
            await workspace.save({ session });
            await reconcileSeats(workspace, session);
          }
        });
      }
    }
    res.json({ received: true });
  }),
);
const customerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  address: Joi.string().trim().min(5).max(500).required(),
  stateCode: Joi.string()
    .pattern(/^\d{2}$/)
    .required(),
  stateName: Joi.string().min(2).max(80).required(),
  gstin: Joi.string()
    .uppercase()
    .pattern(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/)
    .allow(""),
}).required();
export const indiaBillingRoutes = express.Router();
indiaBillingRoutes.use(authenticate);
indiaBillingRoutes.use("/:workspaceId", workspaceAccess);
indiaBillingRoutes.get(
  "/:workspaceId/billing/india",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json({
      configured: !!(
        process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
      ),
      prices: {
        Pro: Number(process.env.WORKSPACE_PRO_INR_PAISE) || null,
        Premium: Number(process.env.WORKSPACE_PREMIUM_INR_PAISE) || null,
      },
      taxRateBps: Number(process.env.GST_RATE_BPS) || 0,
      invoices: await BillingOrder.find({
        workspace: req.workspace._id,
        status: { $in: ["paid", "refunded"] },
      })
        .sort({ paidAt: -1 })
        .limit(100)
        .lean(),
    }),
  ),
);
indiaBillingRoutes.post(
  "/:workspaceId/billing/india/orders",
  permit("owner"),
  wrap(async (req, res) => {
    const { plan, seats, customer, requestKey } = validate(
      Joi.object({
        plan: Joi.string().valid("Pro", "Premium").required(),
        seats: Joi.number().integer().min(1).max(1000).required(),
        customer: customerSchema,
        requestKey: Joi.string().guid().required(),
      }),
      req.body,
    );
    const unit = Number(
        process.env[`WORKSPACE_${plan.toUpperCase()}_INR_PAISE`],
      ),
      rate = Number(process.env.GST_RATE_BPS) || 0;
    if (
      !Number.isInteger(unit) ||
      unit < 100 ||
      !Number.isInteger(rate) ||
      rate < 0 ||
      rate > 10000
    )
      throw fail("Configure workspace INR pricing and tax rate first", 503);
    const seller = {
      name: process.env.GST_SELLER_NAME,
      address: process.env.GST_SELLER_ADDRESS,
      gstin: process.env.GST_SELLER_GSTIN,
      stateCode: process.env.GST_SELLER_STATE_CODE,
      stateName: process.env.GST_SELLER_STATE_NAME,
      sac: process.env.GST_SERVICE_SAC,
    };
    if (
      !seller.name ||
      !seller.address ||
      !seller.stateName ||
      !/^\d{2}$/.test(seller.stateCode || "") ||
      (rate &&
        !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(seller.gstin || ""))
    )
      throw fail(
        "Configure seller invoice details before accepting payments",
        503,
      );
    if (rate && (!seller.sac || seller.gstin.slice(0, 2) !== seller.stateCode))
      throw fail(
        "Configure seller SAC and matching GST state before charging tax",
        503,
      );
    if (customer.gstin && customer.gstin.slice(0, 2) !== customer.stateCode)
      throw fail("GSTIN state and place of supply differ");
    const receipt =
      "QF-" +
      crypto
        .createHash("sha256")
        .update(String(req.workspace._id) + requestKey)
        .digest("hex")
        .slice(0, 24);
    let row = await BillingOrder.findOne({
      receipt,
      workspace: req.workspace._id,
    });
    if (!row) {
      if (
        req.workspace.billing.subscriptionId &&
        !req.workspace.billing.subscriptionId.startsWith("razorpay:") &&
        req.workspace.billing.expiresAt > new Date()
      )
        throw fail("Manage your active subscription first", 409);
      const amount = amounts(
        unit * seats,
        rate,
        seller.stateCode,
        customer.stateCode,
      );
      if (!Number.isSafeInteger(amount.total) || amount.total < 100)
        throw fail("Invalid configured price", 503);
      const remote = await razorpay("orders", {
        method: "POST",
        body: {
          amount: amount.total,
          currency: "INR",
          receipt,
          notes: { workspaceId: String(req.workspace._id) },
        },
      });
      if (!/^order_[A-Za-z0-9]+$/.test(remote.id || ""))
        throw fail("Invalid provider order", 502);
      try {
        row = await BillingOrder.create({
          workspace: req.workspace._id,
          orderId: remote.id,
          receipt,
          plan,
          seats,
          ...amount,
          customer,
          seller,
          taxRate: rate,
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        row = await BillingOrder.findOne({
          workspace: req.workspace._id,
          receipt,
        });
      }
    }
    res.json({
      id: row._id,
      orderId: row.orderId,
      amount: row.total,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      status: row.status,
    });
  }),
);
indiaBillingRoutes.post(
  "/:workspaceId/billing/india/verify",
  permit("owner"),
  wrap(async (req, res) => {
    const { id, paymentId, signature } = validate(
      Joi.object({
        id: Joi.string().hex().length(24).required(),
        paymentId: Joi.string()
          .pattern(/^pay_[A-Za-z0-9]+$/)
          .required(),
        signature: Joi.string().hex().length(64).required(),
      }),
      req.body,
    );
    const order = await BillingOrder.findOne({
      _id: objectId(id),
      workspace: req.workspace._id,
    });
    if (!order) throw fail("Order not found", 404);
    if (
      !secureHex(
        process.env.RAZORPAY_KEY_SECRET || "",
        order.orderId + "|" + paymentId,
        signature,
      )
    )
      throw fail("Invalid payment signature", 401);
    await applyPayment(order, await razorpay("payments/" + paymentId));
    res.json({ paid: true });
  }),
);
indiaBillingRoutes.get(
  "/:workspaceId/billing/india/invoices/:id",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const row = await BillingOrder.findOne({
      _id: objectId(req.params.id),
      workspace: req.workspace._id,
      status: { $in: ["paid", "refunded"] },
    }).lean();
    if (!row) throw fail("Invoice not found", 404);
    res.json({
      ...row,
      ...amounts(
        row.net,
        row.taxRate,
        row.seller.stateCode,
        row.customer.stateCode,
      ),
      invoiceType:
        row.seller.gstin && row.tax > 0
          ? "Tax invoice draft"
          : "Payment receipt",
      reverseCharge: false,
      description: `QuickFix ${row.plan}: ${row.seats} staff seats / 30 days`,
    });
  }),
);
export default indiaBillingRoutes;
