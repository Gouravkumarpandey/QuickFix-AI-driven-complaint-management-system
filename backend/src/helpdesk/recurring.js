import express from "express";
import Joi from "joi";
import crypto from "node:crypto";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { RecurringPlan, BillingOrder, Workspace } from "./models.js";
import { razorpay, applyPayment, amounts } from "./indiaBilling.js";
import {
  workspaceAccess,
  permit,
  withActor,
  objectId,
  audit,
} from "./access.js";
import { validate, fail } from "./validation.js";
export async function recurringEvent(event, provider = razorpay) {
  const id = event.payload?.subscription?.entity?.id;
  if (!/^sub_[A-Za-z0-9]+$/.test(id || "")) return;
  const row = await RecurringPlan.findOne({ subscriptionId: id });
  if (!row) return;
  const remote = await provider("subscriptions/" + id);
  if (
    remote.id !== id ||
    remote.quantity !== row.seats ||
    remote.plan_id !==
      (row.providerPlanId ||
        process.env["RAZORPAY_" + row.plan.toUpperCase() + "_PLAN_ID"])
  )
    throw fail("Subscription details do not match", 409);
  if (event.event === "subscription.charged") {
    const payId = event.payload?.payment?.entity?.id;
    if (!/^pay_[A-Za-z0-9]+$/.test(payId || ""))
      throw fail("Missing subscription payment");
    const payment = await provider("payments/" + payId);
    if (!/^inv_[A-Za-z0-9]+$/.test(payment.invoice_id || ""))
      throw fail("Subscription invoice missing", 409);
    const invoice = await provider("invoices/" + payment.invoice_id);
    if (
      invoice.subscription_id !== id ||
      invoice.payment_id !== payment.id ||
      invoice.status !== "paid" ||
      invoice.amount_paid !== row.total ||
      invoice.currency !== "INR" ||
      payment.amount !== row.total ||
      payment.currency !== "INR" ||
      payment.status !== "captured" ||
      !payment.order_id
    )
      throw fail(
        "Recurring payment does not match the subscription invoice",
        409,
      );
    const currentEnd = new Date(invoice.billing_end * 1000),
      periodDays = (invoice.billing_end - invoice.billing_start) / 86400;
    if (
      !Number.isFinite(currentEnd.getTime()) ||
      !Number.isFinite(periodDays) ||
      periodDays < 27 ||
      periodDays > 32 ||
      currentEnd > new Date(Date.now() + 40 * 86400000)
    )
      throw fail("Invalid monthly invoice billing period", 409);
    let order = await BillingOrder.findOne({ paymentId: payment.id });
    if (!order) {
      try {
        order = await BillingOrder.create({
          workspace: row.workspace,
          recurringId: id,
          orderId: payment.order_id,
          paymentId: payment.id,
          receipt: `QFR-${payment.id}`,
          plan: row.plan,
          seats: row.seats,
          ...row.amount,
          seller: row.seller,
          customer: row.customer,
          taxRate: row.taxRate,
        });
      } catch (e) {
        if (e.code !== 11000) throw e;
        order = await BillingOrder.findOne({ paymentId: payment.id });
        if (!order) throw e;
      }
    }
    if (String(order.workspace) !== String(row.workspace))
      throw fail("Billing workspace mismatch", 409);
    await applyPayment(order, payment, {
      subscriptionId: "razorpay:" + id,
      expiresAt: currentEnd,
    });
    row.currentEnd = new Date(
      Math.max(row.currentEnd?.getTime() || 0, currentEnd.getTime()),
    );
  }
  row.status = remote.status;
  await row.save();
}
const customer = Joi.object({
  name: Joi.string().min(2).max(150).required(),
  address: Joi.string().min(5).max(500).required(),
  stateCode: Joi.string()
    .pattern(/^\d{2}$/)
    .required(),
  stateName: Joi.string().min(2).max(80).required(),
  gstin: Joi.string()
    .uppercase()
    .pattern(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/)
    .allow(""),
});
export const recurringRoutes = express.Router();
recurringRoutes.use(authenticate);
recurringRoutes.use("/:workspaceId", workspaceAccess);
recurringRoutes.get(
  "/:workspaceId/billing/recurring",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json({
      configured: !!(
        process.env.RAZORPAY_PRO_PLAN_ID &&
        process.env.RAZORPAY_PREMIUM_PLAN_ID &&
        process.env.RAZORPAY_KEY_ID
      ),
      subscriptions: await RecurringPlan.find({ workspace: req.workspace._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    }),
  ),
);
recurringRoutes.post(
  "/:workspaceId/billing/recurring",
  permit("owner"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        plan: Joi.string().valid("Pro", "Premium").required(),
        seats: Joi.number().integer().min(1).max(1000).required(),
        requestId: Joi.string().guid().required(),
        customer: customer.required(),
      }),
      req.body,
    );
    const requestKey = digestKey(req.workspace._id + ":" + input.requestId);
    let row = await RecurringPlan.findOne({
      workspace: req.workspace._id,
      requestKey,
    });
    if (row && (row.plan !== input.plan || row.seats !== input.seats))
      throw fail("Request ID already used for another purchase", 409);
    if (!row) {
      const planId =
        process.env["RAZORPAY_" + input.plan.toUpperCase() + "_PLAN_ID"];
      if (!/^plan_[A-Za-z0-9]+$/.test(planId || ""))
        throw fail("Configure a monthly Razorpay plan for this tier", 503);
      const net = Number(
          process.env["WORKSPACE_" + input.plan.toUpperCase() + "_INR_PAISE"],
        ),
        rate = Number(process.env.GST_RATE_BPS || 0);
      if (
        !Number.isSafeInteger(net) ||
        net <= 0 ||
        !Number.isSafeInteger(rate) ||
        rate < 0 ||
        rate > 10000
      )
        throw fail("Billing prices/tax are not configured", 503);
      const seller = {
        name: process.env.GST_SELLER_NAME,
        address: process.env.GST_SELLER_ADDRESS,
        gstin: process.env.GST_SELLER_GSTIN,
        stateCode: process.env.GST_SELLER_STATE_CODE,
        stateName: process.env.GST_SELLER_STATE_NAME,
        sac: process.env.GST_SERVICE_SAC,
      };
      if (!seller.name || !seller.address || !seller.stateCode)
        throw fail("Configure seller billing details", 503);
      const remotePlan = await razorpay("plans/" + planId);
      const unit = amounts(
        net,
        rate,
        seller.stateCode,
        input.customer.stateCode,
      );
      if (
        remotePlan.period !== "monthly" ||
        remotePlan.interval !== 1 ||
        remotePlan.item?.amount !== unit.total ||
        remotePlan.item?.currency !== "INR"
      )
        throw fail(
          "Provider monthly plan must match the tax-inclusive per-seat price",
          409,
        );
      row = await withActor(req, async (session, w) => {
        if (w.billing.expiresAt > new Date() && w.billing.subscriptionId)
          throw fail(
            "Manage the current purchase before starting recurring billing",
            409,
          );
        if (
          await RecurringPlan.exists({
            workspace: w._id,
            status: { $nin: ["cancelled", "completed", "expired", "failed"] },
          }).session(session)
        )
          throw fail(
            "An existing subscription or pending request must be reconciled first",
            409,
          );
        return (
          await RecurringPlan.create(
            [
              {
                workspace: w._id,
                providerPlanId: planId,
                requestKey,
                plan: input.plan,
                seats: input.seats,
                amount: Object.fromEntries(
                  Object.entries(unit).map(([k, v]) => [k, v * input.seats]),
                ),
                total: unit.total * input.seats,
                seller,
                customer: input.customer,
                taxRate: rate,
                status: "creating",
              },
            ],
            { session },
          )
        )[0];
      });
      // Do not automatically retry a create: an interrupted provider response needs reconciliation.
      try {
        const remote = await razorpay("subscriptions", {
          method: "POST",
          body: {
            plan_id: planId,
            quantity: input.seats,
            total_count: 120,
            customer_notify: 1,
            notes: { workspaceId: String(req.workspace._id), requestKey },
          },
        });
        if (!/^sub_[A-Za-z0-9]+$/.test(remote.id || ""))
          throw fail("Unexpected provider response", 502);
        row.subscriptionId = remote.id;
        row.status = remote.status || "created";
        await row.save();
      } catch (e) {
        row.error =
          "Creation outcome uncertain; reconcile this request in the provider dashboard before retrying.";
        await row.save();
        throw e;
      }
    }
    if (!row.subscriptionId)
      throw fail(row.error || "Subscription creation is in progress", 409);
    res.json({
      id: row._id,
      subscriptionId: row.subscriptionId,
      keyId: process.env.RAZORPAY_KEY_ID,
      total: row.total,
      currency: "INR",
    });
  }),
);
recurringRoutes.post(
  "/:workspaceId/billing/recurring/:id/cancel",
  permit("owner"),
  wrap(async (req, res) => {
    const row = await RecurringPlan.findOne({
      _id: objectId(req.params.id),
      workspace: req.workspace._id,
    });
    if (!row?.subscriptionId) throw fail("Subscription not found", 404);
    const remote = await razorpay(
      "subscriptions/" + row.subscriptionId + "/cancel",
      { method: "POST", body: { cancel_at_cycle_end: 1 } },
    );
    row.status = remote.status;
    await row.save();
    await withActor(req, (session, w) =>
      audit(
        w._id,
        req.user._id,
        "billing.recurring-cancelled",
        row._id,
        session,
      ),
    );
    res.json({ status: row.status, paidAccessUntil: row.currentEnd });
  }),
);
recurringRoutes.post(
  "/:workspaceId/billing/recurring/:id/reconcile",
  permit("owner"),
  wrap(async (req, res) => {
    const { subscriptionId } = validate(
      Joi.object({
        subscriptionId: Joi.string()
          .pattern(/^sub_[A-Za-z0-9]+$/)
          .required(),
      }),
      req.body,
    );
    const row = await RecurringPlan.findOne({
      _id: objectId(req.params.id),
      workspace: req.workspace._id,
    });
    if (!row || (row.subscriptionId && row.subscriptionId !== subscriptionId))
      throw fail("Pending subscription not found", 404);
    const remote = await razorpay("subscriptions/" + subscriptionId);
    if (
      remote.notes?.requestKey !== row.requestKey ||
      remote.notes?.workspaceId !== String(row.workspace) ||
      remote.quantity !== row.seats ||
      remote.plan_id !== row.providerPlanId
    )
      throw fail(
        "Provider subscription does not match this purchase request",
        409,
      );
    row.subscriptionId = subscriptionId;
    row.status = remote.status;
    row.error = undefined;
    await row.save();
    const invoices = await razorpay(
      "invoices?subscription_id=" +
        encodeURIComponent(subscriptionId) +
        "&count=100",
    );
    const paid = (invoices.items || [])
      .filter(
        (i) =>
          i.status === "paid" &&
          i.payment_id &&
          i.subscription_id === subscriptionId,
      )
      .sort((a, b) => (b.billing_end || 0) - (a.billing_end || 0));
    if (paid.length)
      await recurringEvent({
        event: "subscription.charged",
        payload: {
          subscription: { entity: { id: subscriptionId } },
          payment: { entity: { id: paid[0].payment_id } },
        },
      });
    await withActor(req, (session, w) =>
      audit(
        w._id,
        req.user._id,
        "billing.recurring-reconciled",
        row._id,
        session,
      ),
    );
    res.json({ reconciled: true });
  }),
);
const digestKey = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export default recurringRoutes;
