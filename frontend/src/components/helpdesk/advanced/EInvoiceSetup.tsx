import { useEffect, useState } from "react";
import api from "../../../utils/api";
type Run = (fn: () => Promise<void>, success?: string) => Promise<void>;
interface Submission {
  _id: string;
  invoice: string;
  environment: string;
  state: string;
  payloadHash: string;
  payload: unknown;
  error?: string;
  acknowledgement?: unknown;
}
export default function EInvoiceSetup({
  workspaceId,
  invoiceId,
  owner,
  run,
}: {
  workspaceId: string;
  invoiceId: string;
  owner: boolean;
  run: Run;
}) {
  const [rows, setRows] = useState<Submission[]>([]),
    [mode, setMode] = useState("sandbox"),
    [configured, setConfigured] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const base = `/workspaces/${workspaceId}/billing/einvoices`;
  async function load() {
    const { data } = await api.get(base);
    setRows(data.submissions);
    setMode(data.environment);
    setConfigured(data.configured);
  }
  useEffect(() => {
    setReviewed(false);
    void load().catch(() => {});
  }, [base, invoiceId]);
  return (
    <section className="rounded-xl border bg-white p-5 space-y-3">
      <h3 className="font-semibold">GST e-invoice registration</h3>
      <p className="text-sm text-slate-600">
        ClearTax {mode} ·{" "}
        {configured
          ? "Credentials configured"
          : "Operator credentials required"}
        . Prepare a government-schema service invoice from the paid invoice
        snapshot, review its exact payload, then submit. This registers an IRN;
        GST return filing requires your GSP’s separate filing and signing
        process.
      </p>
      <form
        className="grid md:grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(async () => {
            await api.post(`${base}/${invoiceId}/prepare`, {
              seller: {
                city: f.get("sellerCity"),
                pin: Number(f.get("sellerPin")),
              },
              buyer: {
                city: f.get("buyerCity"),
                pin: Number(f.get("buyerPin")),
              },
              accountingReviewed: true,
            });
            setReviewed(false);
            await load();
          }, "E-invoice prepared for review.");
        }}
      >
        {[
          ["sellerCity", "Seller city"],
          ["sellerPin", "Seller PIN"],
          ["buyerCity", "Buyer city"],
          ["buyerPin", "Buyer PIN"],
        ].map(([name, label]) => (
          <label className="text-sm" key={name}>
            {label}
            <input
              className="block border rounded p-2 w-full"
              name={name}
              required
              type={name.endsWith("Pin") ? "number" : "text"}
            />
          </label>
        ))}
        <button
          className="border rounded px-3 py-2"
          disabled={!owner || !invoiceId}
        >
          Prepare paid invoice
        </button>
      </form>
      {rows
        .filter((r) => r.invoice === invoiceId)
        .map((r) => (
          <div key={r._id} className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium">
              {r.environment} · {r.state}
            </p>
            <details>
              <summary className="text-sm cursor-pointer">
                Review submission payload
              </summary>
              <pre className="text-xs overflow-auto max-h-80 bg-slate-50 p-3">
                {JSON.stringify(r.payload, null, 2)}
              </pre>
            </details>
            {r.error && <p className="text-sm text-amber-800">{r.error}</p>}
            {!!r.acknowledgement && (
              <details>
                <summary>Government acknowledgement</summary>
                <pre className="text-xs overflow-auto max-h-60">
                  {JSON.stringify(r.acknowledgement, null, 2)}
                </pre>
              </details>
            )}
            {r.state === "prepared" && (
              <>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed this payload and authorize submission to{" "}
                  {r.environment}
                </label>
                <button
                  className="rounded bg-blue-700 text-white px-3 py-2 text-sm"
                  disabled={!owner || !reviewed || !configured}
                  onClick={() =>
                    void run(async () => {
                      await api.post(`${base}/${r._id}/submit`, {
                        payloadHash: r.payloadHash,
                        environment: r.environment,
                        accountingReviewed: true,
                      });
                      setReviewed(false);
                      await load();
                    }, "Submission outcome updated.")
                  }
                >
                  Submit to ClearTax {r.environment}
                </button>
              </>
            )}
          </div>
        ))}
    </section>
  );
}
