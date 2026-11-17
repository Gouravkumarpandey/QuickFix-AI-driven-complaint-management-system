import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { workspaceAccess, permit, withActor, objectId } from "./access.js";
import { actions, validate } from "./validation.js";
import { updateTicket } from "./tickets.js";
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.post(
  "/:workspaceId/tickets/bulk",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        tickets: Joi.array()
          .items(
            Joi.object({
              id: Joi.string().hex().length(24).required(),
              version: Joi.number().integer().min(0).required(),
            }),
          )
          .min(1)
          .max(50)
          .unique("id")
          .required(),
        actions: actions.required(),
      }),
      req.body,
    );
    const result = await withActor(req, async (session, workspace) => {
      const updated = [];
      for (const row of input.tickets)
        updated.push(
          await updateTicket(
            req,
            objectId(row.id),
            { ...input.actions, expectedVersion: row.version },
            session,
            workspace,
          ),
        );
      return updated;
    });
    res.json({ updated: result.length, tickets: result });
  }),
);
export default router;
