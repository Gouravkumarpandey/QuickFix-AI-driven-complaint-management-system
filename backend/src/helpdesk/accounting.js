import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { BillingOrder, AccountingDocument, InvoiceSequence } from "./models.js";
import {
  workspaceAccess,
  permit,
  objectId,
  withActor,
  audit,
} from "./access.js";
import { validate, fail } from "./validation.js";
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId/billing/accounting",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json({
      invoices: await BillingOrder.find({
        workspace: req.workspace._id,
        status: { $in: ["paid", "refunded"] },
      })
        .sort({ paidAt: -1 })
        .limit(100)
        .lean(),
      documents: await AccountingDocument.find({ workspace: req.workspace._id })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    }),
  ),
);
router.post(
  "/:workspaceId/billing/accounting/:invoiceId/issue",
  permit("owner"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        accountingReviewed: Joi.boolean().valid(true).required(),
        eInvoiceRequired: Joi.boolean().required(),
        irn: Joi.string().pattern(/^[a-f0-9]{64}$/i),
        acknowledgementNumber: Joi.string().pattern(/^\d{10,20}$/),
        acknowledgementDate: Joi.date().iso(),
        signedQRCode: Joi.string().max(20000),
        treatmentNote: Joi.string().min(5).max(1000).required(),
      }),
      req.body,
    );
    if (
      input.eInvoiceRequired &&
      (!input.irn ||
        !input.acknowledgementNumber ||
        !input.acknowledgementDate ||
        !input.signedQRCode)
    )
      throw fail(
        "Import the government/GSP acknowledgement before issuing this invoice",
        409,
      );
    const doc = await withActor(req, async (session, w) => {
      const invoice = await BillingOrder.findOne({
        _id: objectId(req.params.invoiceId),
        workspace: w._id,
        status: "paid",
      }).session(session);
      if (!invoice) throw fail("Paid invoice not found", 404);
      if (
        !invoice.seller?.gstin ||
        !invoice.seller?.sac ||
        !invoice.invoiceNumber
      )
        throw fail("Seller GSTIN, SAC and invoice number are required", 409);
      const existing = await AccountingDocument.findOne({
        workspace: w._id,
        invoice: invoice._id,
        kind: "issued-invoice",
      }).session(session);
      if (existing) return existing;
      const [document] = await AccountingDocument.create(
        [
          {
            workspace: w._id,
            invoice: invoice._id,
            kind: "issued-invoice",
            number: invoice.invoiceNumber,
            amount: invoice.total,
            acknowledgement: input,
            reviewedBy: req.user._id,
            reviewedAt: new Date(),
          },
        ],
        { session },
      );
      await audit(
        w._id,
        req.user._id,
        "accounting.invoice-issued",
        document._id,
        session,
      );
      return document;
    });
    res.status(201).json(doc);
  }),
);
router.post(
  "/:workspaceId/billing/accounting/:invoiceId/credit-note",
  permit("owner"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        amount: Joi.number().integer().min(1).required(),
        reason: Joi.string().min(5).max(1000).required(),
        accountingReviewed: Joi.boolean().valid(true).required(),
      }),
      req.body,
    );
    const doc = await withActor(req, async (session, w) => {
      const invoice = await BillingOrder.findOne({
        _id: objectId(req.params.invoiceId),
        workspace: w._id,
        status: { $in: ["paid", "refunded"] },
      }).session(session);
      if (
        !invoice ||
        !(await AccountingDocument.exists({
          workspace: w._id,
          invoice: invoice._id,
          kind: "issued-invoice",
        }).session(session))
      )
        throw fail(
          "Issue the reviewed invoice before creating a credit note",
          409,
        );
      const previous = await AccountingDocument.find({
        workspace: w._id,
        invoice: invoice._id,
        kind: "credit-note",
      }).session(session);
      if (
        previous.reduce((sum, r) => sum + r.amount, 0) + input.amount >
        invoice.total
      )
        throw fail("Credit notes exceed the invoice total", 409);
      const key =
        "CN:" +
        (invoice.seller.gstin || "unregistered") +
        ":" +
        invoice.invoiceNumber.split("/")[0];
      const sequence = await InvoiceSequence.findOneAndUpdate(
        { _id: key },
        { $inc: { value: 1 } },
        { upsert: true, new: true, session },
      );
      const [document] = await AccountingDocument.create(
        [
          {
            workspace: w._id,
            invoice: invoice._id,
            kind: "credit-note",
            number:
              "CN" +
              invoice.invoiceNumber.split("/")[0].replace(/^QF/, "") +
              "/" +
              String(sequence.value).padStart(6, "0"),
            amount: input.amount,
            reason: input.reason,
            reviewedBy: req.user._id,
            reviewedAt: new Date(),
          },
        ],
        { session },
      );
      await audit(
        w._id,
        req.user._id,
        "accounting.credit-note",
        document._id,
        session,
      );
      return document;
    });
    res.status(201).json(doc);
  }),
);
router.get(
  "/:workspaceId/billing/accounting/:invoiceId/export",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const row = await BillingOrder.findOne({
      _id: objectId(req.params.invoiceId),
      workspace: req.workspace._id,
    });
    if (!row) throw fail("Invoice not found", 404);
    const documents = await AccountingDocument.find({
      workspace: req.workspace._id,
      invoice: row._id,
    }).lean();
    // Neutral accounting export. A GSP-specific adapter must map this to its contracted API schema.
    res
      .attachment(
        (row.invoiceNumber || row.receipt).replace(/[^a-z0-9-]/gi, "-") +
          ".json",
      )
      .json({
        version: 1,
        invoice: row,
        documents,
        status: documents.some((d) => d.kind === "issued-invoice")
          ? "reviewed-issued"
          : "draft",
        paymentActionTaken: false,
      });
  }),
);
export default router;
