import "dotenv/config";
import { vectorRequest } from "../src/helpdesk/vectorStore.js";
const size = Number(process.env.EMBEDDING_DIMENSIONS);
if (
  !process.env.QDRANT_URL ||
  !Number.isInteger(size) ||
  size < 1 ||
  size > 8192
)
  throw new Error(
    "Set QDRANT_URL and EMBEDDING_DIMENSIONS to the selected embedding model dimension.",
  );
let collection;
try {
  collection = await vectorRequest("");
} catch {
  await vectorRequest("", {
    method: "PUT",
    body: { vectors: { size, distance: "Cosine" } },
  });
  collection = await vectorRequest("");
}
const vectors = collection.result?.config?.params?.vectors;
if (vectors?.size !== size || vectors?.distance !== "Cosine")
  throw new Error(
    "Existing collection has incompatible dimensions or distance; create a separate collection for the new model.",
  );
for (const field_name of ["workspace", "model"])
  await vectorRequest("/index?wait=true", {
    method: "PUT",
    body: {
      field_name,
      field_schema:
        field_name === "workspace"
          ? { type: "keyword", is_tenant: true }
          : "keyword",
    },
  });
console.log("Vector collection and tenant/model indexes are ready.");
