import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { BillingOrder, EInvoiceSubmission } from "./models.js";
import {
  workspaceAccess,
  permit,
  objectId,
  withActor,
  audit,
} from "./access.js";
import { validate, fail } from "./validation.js";
import { digest } from "./tickets.js";
const environment = () =>
  process.env.CLEARTAX_ENV === "production" ? "production" : "sandbox";
const gstin = Joi.string()
  .pattern(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/)
  .required();
const location = Joi.object({
  city: Joi.string().min(3).max(100).required(),
  pin: Joi.number().integer().min(100000).max(999999).required(),
}).required();
const rupees = (p) => Math.round(p) / 100;
export function invoicePayload(row, places) {
  validate(Joi.object({ seller: location, buyer: location }), places);
  validate(gstin, row.seller?.gstin);
  validate(gstin, row.customer?.gstin);
  if (!/^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/.test(row.invoiceNumber || ""))
    throw fail("The invoice number must meet the IRP 16-character limit");
  if (!/^\d{6}$/.test(row.seller?.sac || ""))
    throw fail("A six-digit service SAC is required");
  if (
    row.currency !== "INR" ||
    !Number.isSafeInteger(row.net) ||
    row.net <= 0 ||
    ![row.cgst, row.sgst, row.igst, row.total].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    row.net + row.cgst + row.sgst + row.igst !== row.total
  )
    throw fail("Invoice totals are inconsistent");
  if (
    row.seller.gstin.slice(0, 2) !== row.seller.stateCode ||
    row.customer.gstin.slice(0, 2) !== row.customer.stateCode
  )
    throw fail("GSTIN and state code do not match");
  if (
    !row.seller.name ||
    !row.customer.name ||
    !row.seller.address ||
    !row.customer.address
  )
    throw fail("Legal names and addresses are required");
  if (
    !Number.isInteger(row.taxRate) ||
    row.taxRate < 0 ||
    row.taxRate > 10000 ||
    Math.round((row.net * row.taxRate) / 10000) !==
      row.cgst + row.sgst + row.igst
  )
    throw fail("Tax rate and amounts are inconsistent");
  if (row.seller.address.length > 200 || row.customer.address.length > 200)
    throw fail("Invoice addresses exceed the IRP address field limit");
  const same = row.seller.stateCode === row.customer.stateCode;
  if (same ? row.igst !== 0 : row.cgst !== 0 || row.sgst !== 0)
    throw fail("Tax treatment does not match the place of supply");
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(row.paidAt));
  const party = (p, l) => ({
    Gstin: p.gstin,
    LglNm: p.name,
    Addr1: p.address.slice(0, 100),
    ...(p.address.length > 100 ? { Addr2: p.address.slice(100, 200) } : {}),
    Loc: l.city,
    Pin: l.pin,
    Stcd: p.stateCode,
  });
  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: row.invoiceNumber, Dt: date },
    SellerDtls: party(row.seller, places.seller),
    BuyerDtls: {
      ...party(row.customer, places.buyer),
      Pos: row.customer.stateCode,
    },
    ItemList: [
      {
        SlNo: "1",
        PrdDesc: `QuickFix ${row.plan} subscription`,
        IsServc: "Y",
        HsnCd: row.seller.sac,
        Qty: 1,
        Unit: "OTH",
        UnitPrice: rupees(row.net),
        TotAmt: rupees(row.net),
        AssAmt: rupees(row.net),
        GstRt: row.taxRate / 100,
        IgstAmt: rupees(row.igst),
        CgstAmt: rupees(row.cgst),
        SgstAmt: rupees(row.sgst),
        TotItemVal: rupees(row.total),
      },
    ],
    ValDtls: {
      AssVal: rupees(row.net),
      CgstVal: rupees(row.cgst),
      SgstVal: rupees(row.sgst),
      IgstVal: rupees(row.igst),
      TotInvVal: rupees(row.total),
    },
  };
}
export async function submitEInvoice(row, request = fetch) {
  const auth = process.env.CLEARTAX_AUTH_TOKEN;
  if (
    !auth ||
    process.env.CLEARTAX_SELLER_GSTIN !== row.payload.SellerDtls.Gstin
  )
    throw fail("Configure ClearTax credentials for this seller GSTIN", 503);
  if (
    row.environment === "production" &&
    process.env.CLEARTAX_PRODUCTION_ENABLED !== "true"
  )
    throw fail("Production e-invoicing is not enabled by the operator", 503);
  const host =
    row.environment === "production"
      ? "https://api.clear.in"
      : "https://api-sandbox.clear.in";
  const response = await request(host + "/einv/v1/govt/api/Invoice/", {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "x-cleartax-auth-token": auth,
      "x-cleartax-product": "EInvoice",
      gstin: row.payload.SellerDtls.Gstin,
    },
    body: JSON.stringify(row.payload),
    signal: AbortSignal.timeout(30000),
  });
  // An HTTP error, timeout or malformed response may follow a successful government registration.
  if (!response.ok)
    throw fail(
      "Provider outcome unknown; reconcile in the ClearTax portal before any further action",
      502,
    );
  const { boundedBody } = await import("./omnichannel.js");
  const result = JSON.parse(
    (await boundedBody(response, 512 * 1024)).toString(),
  );
  if (result.Success === "N")
    return {
      state: "rejected",
      error:
        "Provider rejected the invoice. Review the invoice in ClearTax before preparing a replacement.",
    };
  if (
    result.Success !== "Y" ||
    !/^[a-f0-9]{64}$/i.test(result.Irn || "") ||
    !/^\d{10,20}$/.test(String(result.AckNo || "")) ||
    !result.AckDt ||
    typeof result.SignedQRCode !== "string"
  )
    throw fail("Provider outcome unknown; reconcile in ClearTax", 502);
  return {
    state:
      row.environment === "production" ? "registered" : "sandbox-registered",
    acknowledgement: {
      irn: result.Irn,
      acknowledgementNumber: String(result.AckNo),
      acknowledgementDate: result.AckDt,
      signedQRCode: result.SignedQRCode,
      signedInvoice: result.SignedInvoice,
    },
  };
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId/billing/einvoices",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json({
      environment: environment(),
      configured: !!process.env.CLEARTAX_AUTH_TOKEN,
      submissions: await EInvoiceSubmission.find({
        workspace: req.workspace._id,
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    }),
  ),
);
router.post(
  "/:workspaceId/billing/einvoices/:invoiceId/prepare",
  permit("owner"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        seller: location,
        buyer: location,
        accountingReviewed: Joi.boolean().valid(true).required(),
      }),
      req.body,
    );
    const row = await withActor(req, async (session, w) => {
      const invoice = await BillingOrder.findOne({
        _id: objectId(req.params.invoiceId),
        workspace: w._id,
        status: "paid",
      }).session(session);
      if (!invoice) throw fail("Paid invoice not found", 404);
      const payload = invoicePayload(invoice, {
          seller: input.seller,
          buyer: input.buyer,
        }),
        hash = digest(JSON.stringify(payload));
      const existing = await EInvoiceSubmission.findOne({
        workspace: w._id,
        invoice: invoice._id,
        environment: environment(),
      }).session(session);
      if (existing && !["prepared", "rejected"].includes(existing.state))
        throw fail(
          "Submission already started. Reconcile its outcome before proceeding",
          409,
        );
      const row = await EInvoiceSubmission.findOneAndUpdate(
        { workspace: w._id, invoice: invoice._id, environment: environment() },
        {
          $set: {
            state: "prepared",
            payload,
            payloadHash: hash,
            reviewedBy: req.user._id,
            reviewedAt: new Date(),
          },
          $unset: { error: 1 },
        },
        { upsert: true, new: true, session },
      );
      await audit(w._id, req.user._id, "einvoice.prepared", row._id, session);
      return row;
    });
    res.status(201).json(row);
  }),
);
router.post(
  "/:workspaceId/billing/einvoices/:submissionId/submit",
  permit("owner"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        payloadHash: Joi.string().hex().length(64).required(),
        environment: Joi.string().valid("sandbox", "production").required(),
        accountingReviewed: Joi.boolean().valid(true).required(),
      }),
      req.body,
    );
    const row = await withActor(req, async (session, w) => {
      const row = await EInvoiceSubmission.findOne({
        _id: objectId(req.params.submissionId),
        workspace: w._id,
        state: "prepared",
        payloadHash: input.payloadHash,
        environment: input.environment,
      }).session(session);
      if (!row)
        throw fail("Submission changed or has already been submitted", 409);
      if (
        !process.env.CLEARTAX_AUTH_TOKEN ||
        process.env.CLEARTAX_SELLER_GSTIN !== row.payload.SellerDtls.Gstin
      )
        throw fail("Configure ClearTax credentials for this seller GSTIN", 503);
      if (
        row.environment === "production" &&
        process.env.CLEARTAX_PRODUCTION_ENABLED !== "true"
      )
        throw fail("Production e-invoicing is disabled", 503);
      // Persist before network I/O: interrupted requests must never silently submit twice.
      row.state = "outcome-unknown";
      row.submittedAt = new Date();
      await row.save({ session });
      await audit(
        w._id,
        req.user._id,
        "einvoice.submission-started",
        row._id,
        session,
      );
      return row;
    });
    let update;
    try {
      update = await submitEInvoice(row);
    } catch {
      update = {
        state: "outcome-unknown",
        error:
          "Outcome unknown. Reconcile this invoice in the ClearTax portal; automatic retries are disabled.",
      };
    }
    const result = await EInvoiceSubmission.findOneAndUpdate(
      { _id: row._id, workspace: row.workspace, state: "outcome-unknown" },
      { $set: update },
      { new: true },
    );
    res.json(result);
  }),
);
export default router;
