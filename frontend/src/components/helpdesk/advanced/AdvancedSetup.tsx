import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ShieldCheck,
  Mail,
  Phone,
  MessageCircle,
  CreditCard,
  Activity,
  FlaskConical,
  FileCheck,
} from "lucide-react";
import api from "../../../utils/api";
import { checkoutScript } from "../EnterpriseViews";
type Run = (fn: () => Promise<void>, success?: string) => Promise<void>;
interface Connector {
  _id: string;
  name: string;
  kind: string;
  config?: { businessAccountId?: string };
}
interface Props {
  workspaceId: string;
  slug: string;
  role: string;
  run: Run;
}
const input =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white";
const button =
  "rounded-lg bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-40";
const secondary =
  "rounded-lg border px-3 py-2 text-sm bg-white disabled:opacity-40";
function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white p-5 md:p-6 space-y-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="text-sm text-slate-500">{description}</p>}
      {children}
    </section>
  );
}
function Field({
  label,
  name,
  type = "text",
  required = true,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm space-y-1">
      <span>{label}</span>
      <input
        className={input}
        name={name}
        type={type}
        step={type === "number" ? "any" : undefined}
        required={required}
        placeholder={placeholder}
      />
    </label>
  );
}
function Values(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const form = e.currentTarget;
  return {
    form,
    get: (key: string) => String(new FormData(form).get(key) || ""),
  };
}
export default function AdvancedSetup(props: Props) {
  const [tab, setTab] = useState("Email"),
    [connections, setConnections] = useState<Connector[]>([]);
  useEffect(() => {
    void props.run(async () =>
      setConnections(
        (await api.get(`/workspaces/${props.workspaceId}/connectors`)).data,
      ),
    );
  }, [props.workspaceId, props.run]);
  const tabs = [
    ["Email", Mail],
    ["Calling", Phone],
    ["WhatsApp", MessageCircle],
    ["Identity", ShieldCheck],
    ["Recurring billing", CreditCard],
    ["Accounting", FileCheck],
    ["AI evaluation", FlaskConical],
    ["Service health", Activity],
  ] as const;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-widest text-teal-700">
          Workspace administration
        </p>
        <h2 className="text-2xl font-bold mt-1">Advanced service setup</h2>
        <p className="text-sm text-slate-500 mt-2">
          Connect your business accounts and manage advanced support workflows.
        </p>
      </div>
      <nav
        aria-label="Advanced service sections"
        className="flex gap-2 flex-wrap"
      >
        {tabs.map(([name, Icon]) => (
          <button
            key={name}
            className={tab === name ? button : secondary}
            onClick={() => setTab(name)}
          >
            <Icon size={15} className="inline mr-2" />
            {name}
          </button>
        ))}
      </nav>
      {tab === "Email" && (
        <EmailSetup
          {...props}
          connections={connections.filter((c) => c.kind === "email")}
        />
      )}
      {tab === "Calling" && (
        <VoiceSetup
          {...props}
          connections={connections.filter((c) => c.kind === "phone")}
        />
      )}
      {tab === "WhatsApp" && (
        <WhatsAppSetup
          {...props}
          connections={connections.filter((c) => c.kind === "whatsapp")}
        />
      )}
      {tab === "Identity" && <IdentitySetup {...props} />}
      {tab === "Recurring billing" && <RecurringSetup {...props} />}
      {tab === "Accounting" && <AccountingSetup {...props} />}
      {tab === "AI evaluation" && <EvaluationSetup {...props} />}
      {tab === "Service health" && <Health {...props} />}
    </div>
  );
}
function SelectConnection({
  connections,
  value,
  onChange,
}: {
  connections: Connector[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm space-y-1">
      <span>Connection</span>
      <select
        required
        className={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a connected account</option>
        {connections.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name}
          </option>
        ))}
      </select>
      {!connections.length && (
        <span className="text-slate-500 text-xs">
          Create a connection in Connections or Channels first.
        </span>
      )}
    </label>
  );
}
function EmailSetup({
  workspaceId,
  run,
  connections,
}: Props & { connections: Connector[] }) {
  const [connection, setConnection] = useState("");
  return (
    <Card
      title="Mailbox authorization"
      description="Connect Google or Microsoft with OAuth so mailbox access can refresh without storing an app password. Your operator must register the mail OAuth application and approve the mailbox host."
    >
      <form
        className="space-y-3 max-w-xl"
        onSubmit={(e) => {
          const { get } = Values(e);
          void run(async () => {
            const { data } = await api.post(
              `/workspaces/${workspaceId}/connectors/${connection}/oauth`,
              { provider: get("provider"), user: get("user") },
            );
            location.href = data.url;
          });
        }}
      >
        <SelectConnection
          connections={connections}
          value={connection}
          onChange={setConnection}
        />
        <label className="block text-sm">
          Mail provider
          <select name="provider" className={input}>
            <option value="google">Google Workspace / Gmail</option>
            <option value="microsoft">Microsoft 365 / Outlook</option>
          </select>
        </label>
        <Field label="Mailbox email" name="user" type="email" />
        <button className={button} disabled={!connection}>
          Authorize mailbox
        </button>
      </form>
      <p className="text-xs text-slate-500">
        Use “Format email reply” in a ticket to send bold text, lists and other
        formatting. Plain text is included for mail clients that do not display
        HTML.
      </p>
    </Card>
  );
}
function VoiceSetup({
  workspaceId,
  run,
  connections,
}: Props & { connections: Connector[] }) {
  const [connection, setConnection] = useState(""),
    [record, setRecord] = useState(false),
    [ivr, setIVR] = useState(false);
  return (
    <Card
      title="Browser calling and call routing"
      description="Configure the Twilio Voice SDK application, a recording notice and optional keypad routes. The browser phone is available in each ticket’s phone actions."
    >
      <form
        className="space-y-3 max-w-2xl"
        onSubmit={(e) => {
          const { get } = Values(e);
          void run(async () => {
            const routes = Array.from({ length: 3 }, (_, i) => ({
              digit: String(i + 1),
              label: get("label" + i),
              destination: get("destination" + i),
            })).filter((r) => r.destination);
            const { data } = await api.put(
              `/workspaces/${workspaceId}/connectors/${connection}/voice`,
              {
                ...(get("apiKeySid")
                  ? {
                      apiKeySid: get("apiKeySid"),
                      apiKeySecret: get("apiKeySecret"),
                      appSid: get("appSid"),
                    }
                  : {}),
                recordCalls: record,
                recordingNotice: get("notice"),
                ...(ivr ? { ivr: { greeting: get("greeting"), routes } } : {}),
              },
            );
            if (data.dialCallback)
              await navigator.clipboard?.writeText(
                new URL(
                  data.dialCallback,
                  api.defaults.baseURL?.startsWith("http")
                    ? api.defaults.baseURL
                    : location.origin,
                ).href,
              );
          }, "Calling settings saved. Dial callback copied when clipboard access is available.");
        }}
      >
        <SelectConnection
          connections={connections}
          value={connection}
          onChange={setConnection}
        />
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Twilio API key SID" name="apiKeySid" required={false} />
          <Field
            label="API key secret"
            name="apiKeySecret"
            type="password"
            required={false}
          />
          <Field label="TwiML application SID" name="appSid" required={false} />
        </div>
        <p className="text-xs text-slate-500">
          Register the saved dial callback as your TwiML application's Voice
          URL. Leave SDK fields empty to configure only phone forwarding and
          IVR.
        </p>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={record}
            onChange={(e) => setRecord(e.target.checked)}
          />
          Enable recording and voicemail transcription
        </label>
        <Field
          label="Recording notice played to callers"
          name="notice"
          required={record}
          placeholder="This call may be recorded…"
        />
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={ivr}
            onChange={(e) => setIVR(e.target.checked)}
          />
          Use keypad routing
        </label>
        {ivr && (
          <>
            <Field label="Greeting and keypad instructions" name="greeting" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid md:grid-cols-2 gap-2 border-t pt-3">
                <Field
                  label={`Press ${i + 1}: team name`}
                  name={"label" + i}
                  required={i === 0}
                />
                <Field
                  label="Forward to number (+country code)"
                  name={"destination" + i}
                  required={i === 0}
                />
              </div>
            ))}
          </>
        )}
        <button className={button} disabled={!connection}>
          Save calling setup
        </button>
      </form>
      <p className="text-xs text-slate-500">
        Live call recordings and voicemail transcripts depend on provider
        availability and the configured notice. Provider transcription here
        covers voicemail, not a live agent conversation.
      </p>
    </Card>
  );
}
interface Template {
  id: string;
  name: string;
  status: string;
  language: string;
  category: string;
}
function WhatsAppSetup({
  workspaceId,
  run,
  connections,
}: Props & { connections: Connector[] }) {
  const [connection, setConnection] = useState(""),
    [templates, setTemplates] = useState<Template[]>([]),
    [after, setAfter] = useState<string | null>(null),
    [components, setComponents] = useState(
      '[{"type":"BODY","text":"Hello! How can our support team help you?"}]',
    );
  const base = `/workspaces/${workspaceId}/connectors/${connection}`;
  const load = async (cursor?: string) => {
    const { data } = await api.get(base + "/templates", {
      params: cursor ? { after: cursor } : {},
    });
    setTemplates((v) => (cursor ? [...v, ...data.templates] : data.templates));
    setAfter(data.after);
  };
  return (
    <div className="space-y-5">
      <Card
        title="WhatsApp template approvals"
        description="Submit templates to Meta and check their approval status. Meta controls approval and customer-service messaging windows."
      >
        <SelectConnection
          connections={connections}
          value={connection}
          onChange={(v) => {
            setConnection(v);
            setTemplates([]);
            setAfter(null);
          }}
        />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            const { get } = Values(e);
            void run(async () => {
              await api.put(base + "/whatsapp-account", {
                businessAccountId: get("waba"),
              });
              await load();
            }, "Business account saved.");
          }}
        >
          <div className="flex-1">
            <Field label="WhatsApp Business Account ID" name="waba" />
          </div>
          <button className={button} disabled={!connection}>
            Save account and refresh
          </button>
          <button
            type="button"
            className={secondary}
            disabled={!connection}
            onClick={() => void run(() => load())}
          >
            Refresh status
          </button>
        </form>
        <div className="divide-y">
          {templates.map((t) => (
            <div
              key={t.id}
              className="py-3 flex flex-wrap justify-between gap-2 text-sm"
            >
              <span>
                {t.name} · {t.language}
              </span>
              <span
                className={
                  t.status === "APPROVED"
                    ? "text-emerald-700"
                    : "text-amber-700"
                }
              >
                {t.status}
              </span>
            </div>
          ))}
        </div>
        {after && (
          <button
            className={secondary}
            onClick={() => void run(() => load(after))}
          >
            Load more templates
          </button>
        )}
      </Card>
      <Card title="Submit a new template">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            const { get } = Values(e);
            void run(async () => {
              await api.post(base + "/templates", {
                name: get("name"),
                language: get("language"),
                category: get("category"),
                components: JSON.parse(components),
              });
              await load();
            }, "Template submitted to Meta for review.");
          }}
        >
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Template name (lowercase_underscores)" name="name" />
            <Field label="Language code" name="language" placeholder="en_US" />
            <label className="text-sm">
              Category
              <select className={input} name="category">
                <option>UTILITY</option>
                <option>MARKETING</option>
                <option>AUTHENTICATION</option>
              </select>
            </label>
          </div>
          <label className="block text-sm space-y-1">
            <span>Template components (Meta format)</span>
            <textarea
              className={input + " font-mono"}
              rows={8}
              value={components}
              onChange={(e) => setComponents(e.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500">
            Supports text/media headers, body examples, footer and
            quick-reply/URL/phone buttons. Supply the examples required by Meta
            for variable content.
          </p>
          <button className={button} disabled={!connection}>
            Submit for approval
          </button>
        </form>
      </Card>
    </div>
  );
}
function IdentitySetup({ workspaceId, slug, role, run }: Props) {
  const [token, setToken] = useState(""),
    [baseUrl, setBase] = useState("");
  const samlPath = `/sso/saml/${slug}`;
  const server = api.defaults.baseURL || "/api";
  return (
    <Card
      title="SAML and user provisioning"
      description="SAML uses your operator-configured identity provider. SCIM provisions agent memberships, updates names and deactivates staff within this workspace; it does not grant administrator or owner roles."
    >
      <p className="text-sm break-all">
        Metadata: {server + samlPath + "/metadata"}
      </p>
      <p className="text-sm break-all">
        Sign-in: {server + samlPath + "/start"}
      </p>
      <button
        className={secondary}
        onClick={() =>
          void run(async () => {
            const { data } = await api.post(
              `/workspaces/${workspaceId}/sso/saml/link`,
            );
            location.href = data.url;
          })
        }
      >
        Link my SAML identity
      </button>
      {role === "owner" && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              onClick={() =>
                void run(async () => {
                  const { data } = await api.post(
                    `/workspaces/${workspaceId}/security/scim-token`,
                  );
                  setToken(data.token);
                  setBase(data.baseUrl);
                }, "Provisioning token created. Save it before leaving this page.")
              }
            >
              Create / rotate SCIM token
            </button>
            <button
              className={secondary}
              onClick={() =>
                void run(async () => {
                  await api.delete(
                    `/workspaces/${workspaceId}/security/scim-token`,
                  );
                  setToken("");
                }, "SCIM access revoked.")
              }
            >
              Revoke SCIM access
            </button>
          </div>
          {token && (
            <div className="bg-amber-50 rounded-lg p-4 space-y-2 text-sm">
              <p>Shown once. Expires in 90 days.</p>
              <p className="break-all">Base URL: {baseUrl}</p>
              <code className="block break-all select-all">{token}</code>
              <button className={secondary} onClick={() => setToken("")}>
                I saved this token
              </button>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Set the IdP’s SCIM externalId to its persistent SAML NameID.
            Existing accounts must join the workspace explicitly before
            provisioning. SCIM groups and password changes are not supported.
          </p>
        </div>
      )}
    </Card>
  );
}
interface Subscription {
  _id: string;
  plan: string;
  seats: number;
  status: string;
  currentEnd?: string;
  subscriptionId?: string;
  error?: string;
}
function RecurringSetup({ workspaceId, role, run }: Props) {
  const [rows, setRows] = useState<Subscription[]>([]),
    [configured, setConfigured] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [reconcileIDs, setReconcileIDs] = useState<Record<string, string>>({});
  const base = `/workspaces/${workspaceId}/billing/recurring`;
  const load = useCallback(async () => {
    const { data } = await api.get(base);
    setRows(data.subscriptions);
    setConfigured(data.configured);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <Card
      title="Recurring payments / UPI AutoPay"
      description="Your merchant account must support Razorpay Subscriptions and UPI mandates. A subscription grants access only after the server receives and verifies a captured recurring payment."
    >
      {!configured && (
        <p className="text-sm text-amber-700">
          The operator must configure tax-inclusive monthly Razorpay plan IDs
          for both paid tiers.
        </p>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          const { get } = Values(e);
          void run(async () => {
            const { data } = await api.post(base, {
              requestId,
              plan: get("plan"),
              seats: Number(get("seats")),
              customer: {
                name: get("name"),
                address: get("address"),
                stateCode: get("stateCode"),
                stateName: get("stateName"),
                gstin: get("gstin"),
              },
            });
            await checkoutScript();
            const checkout = new window.Razorpay!({
              key: data.keyId,
              subscription_id: data.subscriptionId,
              name: "QuickFix",
              description: "Monthly support workspace subscription",
              handler: () => {
                void run(
                  load,
                  "Mandate submitted. Access updates after a verified payment webhook.",
                );
              },
            });
            checkout.open();
            await load();
          });
        }}
      >
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-sm">
            Plan
            <select name="plan" className={input}>
              <option>Pro</option>
              <option>Premium</option>
            </select>
          </label>
          <Field label="Staff seats" name="seats" type="number" />
          <Field label="Billing name" name="name" />
          <Field label="Billing address" name="address" />
          <Field label="State code" name="stateCode" />
          <Field label="State name" name="stateName" />
          <Field label="GSTIN (optional)" name="gstin" required={false} />
        </div>
        <button className={button} disabled={!configured || role !== "owner"}>
          Authorize recurring payment
        </button>
        <button
          type="button"
          className={secondary + " ml-2"}
          onClick={() => setRequestId(crypto.randomUUID())}
        >
          New purchase request
        </button>
      </form>
      <div className="divide-y">
        {rows.map((r) => (
          <div
            key={r._id}
            className="py-3 flex flex-wrap gap-3 justify-between items-center text-sm"
          >
            <div>
              <p>
                {r.plan} · {r.seats} seats · {r.status}
              </p>
              {r.currentEnd && (
                <p className="text-xs text-slate-500">
                  Paid through {new Date(r.currentEnd).toLocaleDateString()}
                </p>
              )}
              {r.error && (
                <div className="space-y-2 mt-2">
                  <p className="text-xs text-amber-700">{r.error}</p>
                  <input
                    aria-label="Provider subscription ID to reconcile"
                    className={input}
                    placeholder="sub_… from your Razorpay dashboard"
                    value={reconcileIDs[r._id] || ""}
                    onChange={(e) =>
                      setReconcileIDs((v) => ({
                        ...v,
                        [r._id]: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className={secondary}
                    disabled={!reconcileIDs[r._id] || role !== "owner"}
                    onClick={() =>
                      void run(async () => {
                        await api.post(base + "/" + r._id + "/reconcile", {
                          subscriptionId: reconcileIDs[r._id],
                        });
                        await load();
                      }, "Subscription reconciled against the provider.")
                    }
                  >
                    Reconcile purchase
                  </button>
                </div>
              )}
            </div>
            {r.subscriptionId &&
              role === "owner" &&
              !["cancelled", "completed", "expired"].includes(r.status) && (
                <button
                  className={secondary}
                  onClick={() =>
                    void run(async () => {
                      await api.post(base + "/" + r._id + "/cancel");
                      await load();
                    }, "Renewal cancellation requested. Paid access continues through its expiry.")
                  }
                >
                  Cancel renewal
                </button>
              )}
          </div>
        ))}
      </div>
      <button className={secondary} onClick={() => void run(load)}>
        Refresh subscriptions
      </button>
    </Card>
  );
}
interface Invoice {
  _id: string;
  invoiceNumber?: string;
  receipt: string;
  total: number;
  status: string;
}
interface Document {
  _id: string;
  invoice: string;
  kind: string;
  number: string;
  amount: number;
}
function AccountingSetup({ workspaceId, role, run }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]),
    [documents, setDocuments] = useState<Document[]>([]),
    [invoice, setInvoice] = useState(""),
    [required, setRequired] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const base = `/workspaces/${workspaceId}/billing/accounting`;
  const load = useCallback(async () => {
    const { data } = await api.get(base);
    setInvoices(data.invoices);
    setDocuments(data.documents);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="space-y-5">
      <Card
        title="Reviewed invoices and credit notes"
        description="Have your accounting team verify tax treatment. Where e-invoicing applies, obtain the government/GSP acknowledgement before issuing. Recording an acknowledgement here does not file a GST return or move money."
      >
        <label className="block text-sm">
          Invoice
          <select
            className={input}
            value={invoice}
            onChange={(e) => {
              setInvoice(e.target.value);
              setReviewed(false);
            }}
          >
            <option value="">Choose a paid invoice</option>
            {invoices.map((i) => (
              <option key={i._id} value={i._id}>
                {i.invoiceNumber || i.receipt} · ₹{(i.total / 100).toFixed(2)} ·{" "}
                {i.status}
              </option>
            ))}
          </select>
        </label>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            const { get } = Values(e);
            void run(async () => {
              await api.post(base + "/" + invoice + "/issue", {
                accountingReviewed: reviewed,
                eInvoiceRequired: required,
                treatmentNote: get("note"),
                ...(required
                  ? {
                      irn: get("irn"),
                      acknowledgementNumber: get("ack"),
                      acknowledgementDate: get("date"),
                      signedQRCode: get("qr"),
                    }
                  : {}),
              });
              await load();
            }, "Reviewed invoice issued.");
          }}
        >
          <Field label="Accounting review / tax-treatment note" name="note" />
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            E-invoice acknowledgement required
          </label>
          {required && (
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="IRN" name="irn" />
              <Field label="Acknowledgement number" name="ack" />
              <Field
                label="Acknowledgement timestamp"
                name="date"
                type="datetime-local"
              />
              <Field label="Signed QR code data" name="qr" />
            </div>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            Accounting has reviewed these details
          </label>
          <button
            className={button}
            disabled={!invoice || !reviewed || role !== "owner"}
          >
            Issue reviewed invoice
          </button>
          <button
            type="button"
            className={secondary + " ml-2"}
            disabled={!invoice}
            onClick={() =>
              void run(async () => {
                const { data } = await api.get(
                  base + "/" + invoice + "/export",
                  { responseType: "blob" },
                );
                const url = URL.createObjectURL(data);
                const a = document.createElement("a");
                a.href = url;
                a.download = "accounting-export.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              })
            }
          >
            Export accounting package
          </button>
        </form>
      </Card>
      <Card title="Create a credit note">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            const { get } = Values(e);
            void run(async () => {
              await api.post(base + "/" + invoice + "/credit-note", {
                amount: Math.round(Number(get("amount")) * 100),
                reason: get("reason"),
                accountingReviewed: reviewed,
              });
              await load();
            }, "Credit note recorded. No refund was initiated.");
          }}
        >
          <Field label="Credit amount (INR)" name="amount" type="number" />
          <div className="flex-1">
            <Field label="Reason" name="reason" />
          </div>
          <button
            className={button}
            disabled={!invoice || !reviewed || role !== "owner"}
          >
            Record credit note
          </button>
        </form>
        {documents
          .filter((d) => d.invoice === invoice)
          .map((d) => (
            <div key={d._id} className="text-sm border-t pt-3">
              {d.number} · {d.kind} · ₹{(d.amount / 100).toFixed(2)}
            </div>
          ))}
      </Card>
    </div>
  );
}
interface Benchmark {
  _id: string;
  name: string;
  status: string;
  passRate?: number;
  results?: {
    question: string;
    passed: boolean;
    handoffOK: boolean;
    phrasesOK: boolean;
    citationsOK: boolean;
  }[];
}
function EvaluationSetup({ workspaceId, run }: Props) {
  const [rows, setRows] = useState<Benchmark[]>([]),
    [cases, setCases] = useState(
      '[{"question":"How do I reset my password?","handoff":true}]',
    );
  const base = `/workspaces/${workspaceId}/ai/benchmarks`;
  const load = useCallback(
    async () => setRows((await api.get(base)).data),
    [base],
  );
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <Card
      title="AI acceptance checks"
      description="Build a repeatable set of customer questions. Checks compare expected handoff, required phrases and source IDs; the score is an acceptance check, not a guarantee of answer correctness."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          const { get } = Values(e);
          void run(async () => {
            await api.post(base, {
              name: get("name"),
              cases: JSON.parse(cases),
            });
            await load();
          }, "AI acceptance checks queued for the worker.");
        }}
      >
        <Field label="Evaluation name" name="name" />
        <label className="block text-sm">
          Cases (up to 20)
          <textarea
            className={input + " font-mono mt-1"}
            rows={6}
            value={cases}
            onChange={(e) => setCases(e.target.value)}
          />
        </label>
        <p className="text-xs text-slate-500">
          Each case has question and handoff. Optional requiredPhrases and
          sourceIds check supported answers against your expected evidence.
        </p>
        <button className={button}>Run acceptance checks</button>
        <button
          type="button"
          className={secondary + " ml-2"}
          onClick={() => void run(load)}
        >
          Refresh results
        </button>
      </form>
      {rows.map((r) => (
        <details key={r._id} className="border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            {r.name} · {r.status}
            {r.passRate != null
              ? ` · ${Math.round(r.passRate * 100)}% passed`
              : ""}
          </summary>
          {r.results?.map((t, i) => (
            <div key={i} className="py-3 text-xs">
              <p>
                {t.passed ? "✓" : "✕"} {t.question}
              </p>
              <p className="text-slate-500 mt-1">
                Handoff: {t.handoffOK ? "pass" : "fail"} · Phrases:{" "}
                {t.phrasesOK ? "pass" : "fail"} · Sources:{" "}
                {t.citationsOK ? "pass" : "fail"}
              </p>
            </div>
          ))}
        </details>
      ))}
    </Card>
  );
}
interface HealthData {
  ready: boolean;
  components: Record<string, boolean>;
  failedDeliveries: number;
  pendingDeliveries: number;
  privateStorageBytes: number;
  vectorStore: string;
  mailboxErrors: { _id: string; name: string; syncError: string }[];
  samlConfigured: boolean;
  scim: { expiresAt: string } | null;
}
function Health({ workspaceId, run }: Props) {
  const [state, setState] = useState<HealthData | null>(null);
  const load = useCallback(
    async () =>
      setState(
        (await api.get(`/workspaces/${workspaceId}/operations/health`)).data,
      ),
    [workspaceId],
  );
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <Card
      title="Service health"
      description="Core service checks and delivery backlogs reflect the running environment. A configured provider still needs a real delivery test."
    >
      <button className={secondary} onClick={() => void run(load)}>
        Refresh health
      </button>
      {state && (
        <>
          <div className="grid md:grid-cols-3 gap-3">
            {Object.entries(state.components).map(([k, v]) => (
              <div key={k} className="rounded-lg border p-4">
                <p className="text-xs text-slate-500 capitalize">
                  {k.replace(/([A-Z])/g, " $1")}
                </p>
                <p
                  className={
                    "font-semibold mt-2 " +
                    (v ? "text-emerald-700" : "text-amber-700")
                  }
                >
                  {v ? "Ready" : "Needs attention"}
                </p>
              </div>
            ))}
          </div>
          <p className="text-sm">
            Pending deliveries: {state.pendingDeliveries} · Failed:{" "}
            {state.failedDeliveries} · Private files:{" "}
            {(state.privateStorageBytes / 1024 / 1024).toFixed(1)} MiB
          </p>
          <p className="text-sm">
            Knowledge search: {state.vectorStore} · SAML:{" "}
            {state.samlConfigured ? "configured" : "not configured"} · SCIM:{" "}
            {state.scim
              ? `expires ${new Date(state.scim.expiresAt).toLocaleDateString()}`
              : "not enabled"}
          </p>
          {state.mailboxErrors.map((m) => (
            <p className="text-sm text-amber-700" key={m._id}>
              {m.name}: {m.syncError}
            </p>
          ))}
        </>
      )}
      <p className="text-xs text-slate-500">
        Operator backup and monitoring commands are documented in the deployment
        guide. Verify a restore in an isolated environment before relying on
        backups.
      </p>
    </Card>
  );
}
