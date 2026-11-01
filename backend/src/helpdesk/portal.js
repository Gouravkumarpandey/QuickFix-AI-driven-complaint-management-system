import express from "express";
import Joi from "joi";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Workspace, Article, Ticket, Message } from "./models.js";
import { fail, validate, text, oid } from "./validation.js";
import { inWorkspace } from "./access.js";
import { createTicket, addMessage, digest } from "./tickets.js";
const router = express.Router();
router.use(
  rateLimit({
    windowMs: 15 * 60000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
router.use(
  "/:slug",
  wrap(async (req, res, next) => {
    const workspace = await Workspace.findOne({
      slug: req.params.slug,
      "settings.publicPortal": true,
    });
    if (!workspace) throw fail("Help centre not found", 404);
    req.workspace = workspace;
    next();
  }),
);
router.get(
  "/:slug",
  wrap(async (req, res) =>
    res.json({
      name: req.workspace.name,
      slug: req.workspace.slug,
      fields: req.workspace.settings.customFields,
      language: req.workspace.settings.language,
    }),
  ),
);
router.get(
  "/:slug/articles",
  wrap(async (req, res) => {
    const input = validate(
        Joi.object({
          search: Joi.string().max(100),
          language: Joi.string().max(20),
        }),
        req.query,
      ),
      query = { workspace: req.workspace._id, published: true };
    if (input.language) query.language = input.language;
    if (input.search)
      query.$or = ["title", "body"].map((field) => ({
        [field]: {
          $regex: input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      }));
    res.json(
      await Article.find(query)
        .select("slug title body category language updatedAt")
        .limit(100)
        .lean(),
    );
  }),
);
router.post(
  "/:slug/tickets",
  rateLimit({
    windowMs: 15 * 60000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        name: Joi.string().max(100).required(),
        email: Joi.string().email().lowercase().required(),
        subject: Joi.string().min(3).max(200).required(),
        description: text.min(3).required(),
        customFields: Joi.object(),
        channel: Joi.string().valid("web", "chat").default("web"),
      }),
      req.body,
    );
    const result = await inWorkspace(req.workspace._id, (session, workspace) =>
      createTicket(workspace, input, "portal", session, { guest: true }),
    );
    res
      .status(201)
      .json({
        id: result.ticket._id,
        number: result.ticket.number,
        accessToken: result.accessToken,
      });
  }),
);
const guest = async (req) => {
  const id = validate(oid.required(), req.params.ticketId),
    token = req.get("X-Ticket-Token");
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw fail("Ticket not found", 404);
  const ticket = await Ticket.findOne({
    _id: id,
    workspace: req.workspace._id,
    guestTokenHash: digest(token),
  });
  if (!ticket) throw fail("Ticket not found", 404);
  return ticket;
};
router.post(
  "/:slug/tickets/:ticketId/verify-email",
  wrap(async (req, res) => {
    const { proof } = validate(
        Joi.object({ proof: Joi.string().hex().length(64).required() }),
        req.body,
      ),
      rawToken = crypto.randomBytes(32).toString("hex");
    const ticket = await inWorkspace(
      req.workspace._id,
      async (session, workspace) => {
        const ticket = await Ticket.findOne({
          _id: validate(oid.required(), req.params.ticketId),
          workspace: workspace._id,
          guest: true,
          guestVerified: false,
          emailVerifyHash: digest(proof),
          emailVerifyExpires: { $gt: new Date() },
        }).session(session);
        if (!ticket) throw fail("Verification link is invalid or expired", 404);
        ticket.guestVerified = true;
        ticket.guestTokenHash = digest(rawToken);
        ticket.emailVerifyHash = undefined;
        ticket.emailVerifyExpires = undefined;
        await ticket.save({ session });
        return ticket;
      },
    );
    res.json({ id: ticket._id, number: ticket.number, accessToken: rawToken });
  }),
);
router.get(
  "/:slug/tickets/:ticketId",
  wrap(async (req, res) => {
    const ticket = await guest(req);
    const messages = await Message.find({
      workspace: req.workspace._id,
      ticket: ticket._id,
      internal: false,
    })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    res.json({
      ticket: {
        _id: ticket._id,
        number: ticket.number,
        subject: ticket.subject,
        status: ticket.status,
      },
      messages,
    });
  }),
);
router.post(
  "/:slug/tickets/:ticketId/messages",
  wrap(async (req, res) => {
    const input = validate(
        Joi.object({ text: text.min(1).required() }),
        req.body,
      ),
      ticket = await guest(req);
    const message = await inWorkspace(
      req.workspace._id,
      async (session, workspace) => {
        const current = await Ticket.findOne({
          _id: ticket._id,
          workspace: workspace._id,
        }).session(session);
        return addMessage(
          workspace,
          current,
          input,
          "portal",
          "customer",
          session,
        );
      },
    );
    res.status(201).json(message);
  }),
);
router.get(
  "/:slug/widget.js",
  wrap(async (req, res) => {
    const origin = new URL(process.env.FRONTEND_URL || "http://localhost:5173")
        .origin,
      url = `${origin}/support/${req.workspace.slug}?widget=1`;
    res
      .type("application/javascript")
      .set("Cache-Control", "public, max-age=300")
      .send(
        `(()=>{const b=document.createElement('button');b.textContent='Chat with support';Object.assign(b.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:2147483646,padding:'12px 18px',borderRadius:'24px',border:'0',background:'#2563eb',color:'white',cursor:'pointer'});const f=document.createElement('iframe');f.src=${JSON.stringify(url)};f.title='Customer support';f.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin');Object.assign(f.style,{display:'none',position:'fixed',right:'20px',bottom:'76px',width:'min(400px,95vw)',height:'min(600px,80vh)',border:'1px solid #ddd',borderRadius:'16px',zIndex:2147483646,background:'white'});b.onclick=()=>f.style.display=f.style.display==='none'?'block':'none';document.body.append(b,f)})();`,
      );
  }),
);
export default router;
