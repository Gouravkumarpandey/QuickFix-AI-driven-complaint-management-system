import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Workspace, AIBenchmark } from "./models.js";
import { workspaceAccess, permit, withActor } from "./access.js";
import { requireFeature } from "./entitlements.js";
import { enqueue } from "./tickets.js";
import { faqAnswer } from "./semantic.js";
import { validate } from "./validation.js";
export async function runBenchmark(id, answer = faqAnswer) {
  const row = await AIBenchmark.findById(id);
  if (!row || row.status === "completed") return;
  const workspace = await Workspace.findById(row.workspace);
  requireFeature(workspace, "semantic");
  const results = [];
  for (const test of row.cases) {
    const response = await answer(workspace, test.question);
    const handoffOK = response.handoff === test.handoff;
    const phrasesOK =
      test.handoff ||
      (test.requiredPhrases || []).every((v) =>
        (response.answer || "").toLowerCase().includes(v.toLowerCase()),
      );
    const citationsOK =
      test.handoff ||
      !(test.sourceIds || []).length ||
      response.sources?.some((s) => test.sourceIds.includes(String(s.id)));
    results.push({
      question: test.question,
      passed: !!(handoffOK && phrasesOK && citationsOK),
      handoffOK,
      phrasesOK,
      citationsOK: !!citationsOK,
      response,
    });
  }
  row.results = results;
  row.status = "completed";
  row.completedAt = new Date();
  row.passRate = results.filter((r) => r.passed).length / results.length;
  await row.save();
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId/ai/benchmarks",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json(
      await AIBenchmark.find({ workspace: req.workspace._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ),
  ),
);
router.post(
  "/:workspaceId/ai/benchmarks",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "semantic");
    const input = validate(
      Joi.object({
        name: Joi.string().min(2).max(100).required(),
        cases: Joi.array()
          .items(
            Joi.object({
              question: Joi.string().min(3).max(1000).required(),
              handoff: Joi.boolean().required(),
              requiredPhrases: Joi.array()
                .items(Joi.string().max(200))
                .max(10)
                .default([]),
              sourceIds: Joi.array()
                .items(Joi.string().hex().length(24))
                .max(5)
                .default([]),
            }),
          )
          .min(1)
          .max(20)
          .required(),
      }),
      req.body,
    );
    const row = await withActor(req, async (session, w) => {
      const [row] = await AIBenchmark.create([{ ...input, workspace: w._id }], {
        session,
      });
      await enqueue(
        w._id,
        "ai.evaluate",
        { id: String(row._id) },
        "benchmark:" + row._id,
        session,
      );
      return row;
    });
    res.status(202).json(row);
  }),
);
export default router;
