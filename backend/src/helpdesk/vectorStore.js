import crypto from "node:crypto";
import { fail } from "./validation.js";
export const vectorEnabled = () => !!process.env.QDRANT_URL;
const collection = () => {
  const name = process.env.QDRANT_COLLECTION || "quickfix_knowledge";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(name))
    throw fail("Invalid vector collection name", 503);
  return name;
};
export async function vectorRequest(
  suffix,
  { method = "GET", body } = {},
  fetcher = fetch,
) {
  const url = new URL(process.env.QDRANT_URL);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw fail("Invalid operator vector endpoint", 503);
  const response = await fetcher(
    new URL(`/collections/${collection()}${suffix}`, url.origin),
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QDRANT_API_KEY
          ? { "api-key": process.env.QDRANT_API_KEY }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw fail("Vector database request failed", 503);
  return response.json();
}
const pointId = (value) => {
  const hex = crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export async function upsertVectors(rows, fetcher = fetch) {
  if (!rows.length) return;
  await vectorRequest(
    "/points?wait=true",
    {
      method: "PUT",
      body: {
        points: rows.map((r) => ({
          id: pointId(String(r._id)),
          vector: r.vector,
          payload: {
            workspace: String(r.workspace),
            model: r.model,
            rowId: String(r._id),
          },
        })),
      },
    },
    fetcher,
  );
}
export async function queryVectors(workspace, model, vector, fetcher = fetch) {
  const data = await vectorRequest(
    "/points/query",
    {
      method: "POST",
      body: {
        query: vector,
        limit: 50,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [
            { key: "workspace", match: { value: String(workspace) } },
            { key: "model", match: { value: model } },
          ],
        },
      },
    },
    fetcher,
  );
  return (data.result?.points || [])
    .filter(
      (p) =>
        p.payload?.workspace === String(workspace) &&
        p.payload?.model === model &&
        /^[a-f0-9]{24}$/.test(p.payload?.rowId || "") &&
        Number.isFinite(p.score),
    )
    .map((p) => ({ rowId: p.payload.rowId, score: p.score }));
}
export async function pruneVectors(workspace, ids, fetcher = fetch) {
  await vectorRequest(
    "/points/delete?wait=true",
    {
      method: "POST",
      body: {
        filter: {
          must: [{ key: "workspace", match: { value: String(workspace) } }],
          ...(ids.length
            ? { must_not: [{ has_id: ids.map((id) => pointId(String(id))) }] }
            : {}),
        },
      },
    },
    fetcher,
  );
}
