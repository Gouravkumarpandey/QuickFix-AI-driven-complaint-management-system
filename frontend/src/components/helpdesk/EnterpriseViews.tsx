import { useCallback, useEffect, useState, type ReactNode } from "react";
import api from "../../utils/api";
import { ShieldCheck, CheckCircle2, AlertCircle, KeyRound } from "lucide-react";
type Run = (action: () => Promise<void>, success?: string) => Promise<void>;
const input =
  "w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";
const button =
  "rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const secondary = "rounded-lg border bg-white px-3 py-2 text-sm";
const error = (e: unknown) =>
  (e as { response?: { data?: { error?: string } }; message?: string }).response
    ?.data?.error || (e as Error).message;
export function MfaBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
      enabled: boolean;
      verified: boolean;
    } | null>(null),
    [code, setCode] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    api
      .get("/security/mfa")
      .then((r) => setState(r.data))
      .catch((e) => setMessage(error(e)));
  }, []);
  if (!state)
    return (
      <div className="p-10 text-center" role="status">
        {message || "Checking account security…"}
      </div>
    );
  if (!state.enabled || state.verified) return <>{children}</>;
  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center p-5">
      <form
        className="max-w-md w-full p-8 bg-white border rounded-2xl space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const { data } = await api.post("/security/mfa/verify", { code });
            localStorage.setItem("token", data.token);
            location.reload();
          } catch (e) {
            setMessage(error(e));
          }
        }}
      >
        <ShieldCheck className="text-teal-700" size={32} />
        <h1 className="text-2xl font-bold">Verify your sign-in</h1>
        <p className="text-sm text-slate-500">
          Enter your authenticator code or one unused recovery code.
        </p>
        <input
          required
          autoComplete="one-time-code"
          aria-label="Authenticator or recovery code"
          className={input}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {message && (
          <p role="alert" className="text-sm text-red-700">
            {message}
          </p>
        )}
        <button className={button}>Verify and continue</button>
      </form>
    </div>
  );
}
export function SSOExchange() {
  const [message, setMessage] = useState("Completing company sign-in…");
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("code");
    if (!code) {
      setMessage("Missing sign-in code");
      return;
    }
    let started = false;
    const timer = setTimeout(() => {
      if (started) return;
      started = true;
      api
        .post("/sso/exchange", { code })
        .then(({ data }) => {
          localStorage.setItem("token", data.token);
          localStorage.setItem("user", JSON.stringify(data.user));
          location.replace("/workspaces");
        })
        .catch((e) => setMessage(error(e)));
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="p-12 text-center" role="status">
      {message}
    </div>
  );
}
export function SSOLogin() {
  const [slug, setSlug] = useState("");
  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center p-5">
      <form
        className="bg-white border p-8 rounded-2xl max-w-md w-full space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          location.href = new URL(
            (api.defaults.baseURL || "/api").replace(/\/$/, "") +
              "/sso/" +
              encodeURIComponent(slug) +
              "/start",
            location.origin,
          ).href;
        }}
      >
        <KeyRound className="text-teal-700" size={32} />
        <h1 className="text-2xl font-bold">Company sign-in</h1>
        <p className="text-sm text-slate-500">
          Use your company’s QuickFix workspace address. Link your identity from
          Security once before signing in with SSO.
        </p>
        <label className="block text-sm">
          Workspace address
          <input
            className={input + " mt-1"}
            required
            pattern="[a-z0-9-]{3,50}"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="your-company"
          />
        </label>
        <button className={button}>Continue with SSO</button>
        <a className="block text-sm text-teal-700" href="/login">
          Sign in with email instead
        </a>
      </form>
    </div>
  );
}
interface Props {
  workspaceId: string;
  view: string;
  role: string;
  run: Run;
  busy: boolean;
}
export default function EnterpriseView(props: Props) {
  if (props.view === "Security") return <SecurityView {...props} />;
  if (props.view === "Channels") return <ChannelsView {...props} />;
  if (props.view === "India billing") return <IndiaBilling {...props} />;
  if (props.view === "AI studio") return <AIStudio {...props} />;
  if (props.view === "Migration") return <MigrationView {...props} />;
  return <ReadinessView {...props} />;
}
interface Role {
  _id: string;
  name: string;
  permissions: string[];
}
function SecurityView({ workspaceId, role, run, busy }: Props) {
  const [mfa, setMfa] = useState({ enabled: false }),
    [security, setSecurity] = useState<{
      ssoEnabled: boolean;
      providerConfigured: boolean;
      permissions: string[];
      roles: Role[];
    }>({
      ssoEnabled: false,
      providerConfigured: false,
      permissions: [],
      roles: [],
    }),
    [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null),
    [recovery, setRecovery] = useState<string[]>([]),
    [code, setCode] = useState(""),
    [roleName, setRoleName] = useState(""),
    [editingRole, setEditingRole] = useState(""),
    [permissions, setPermissions] = useState<string[]>([]),
    [members, setMembers] = useState<
      {
        _id: string;
        name: string;
        email: string;
        role: string;
        customRole?: string;
      }[]
    >([]);
  const base = `/workspaces/${workspaceId}`;
  const load = useCallback(async () => {
    const m = await api.get("/security/mfa");
    setMfa(m.data);
    if (["owner", "admin"].includes(role)) {
      const [s, t] = await Promise.all([
        api.get(base + "/security"),
        api.get(base + "/members"),
      ]);
      setSecurity(s.data);
      setMembers(t.data);
    } else {
      const s = await api.get(base + "/sso/status");
      setSecurity((old) => ({ ...old, ...s.data }));
    }
  }, [base, role]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="space-y-5">
      <section className="border bg-white rounded-xl p-6 space-y-4">
        <h2 className="text-xl font-semibold">Account security</h2>
        <p className="text-sm text-slate-500">
          Authenticator-based MFA protects your account on every API sign-in.
          Keep recovery codes somewhere private.
        </p>
        {mfa.enabled ? (
          <>
            <p className="text-emerald-700 text-sm">MFA is enabled.</p>
            <div className="flex flex-wrap gap-2">
              <input
                className={input + " max-w-xs"}
                aria-label="Disable MFA code"
                placeholder="Authenticator or recovery code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                className={secondary}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.post("/security/mfa/disable", { code });
                    setCode("");
                    await load();
                  }, "MFA disabled.")
                }
              >
                Disable MFA
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { data } = await api.post("/security/mfa/enroll");
                  setSetup(data);
                })
              }
            >
              Set up authenticator
            </button>
            {setup && (
              <div className="space-y-3">
                <img
                  src={setup.qr}
                  width={180}
                  height={180}
                  alt="Scan this authenticator setup QR code"
                />
                <p className="text-xs break-all">
                  Manual setup secret: {setup.secret}
                </p>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const { data } = await api.post("/security/mfa/confirm", {
                        code,
                      });
                      localStorage.setItem("token", data.token);
                      setRecovery(data.recoveryCodes);
                      setSetup(null);
                      setCode("");
                      await load();
                    }, "MFA enabled. Save your recovery codes.");
                  }}
                >
                  <input
                    required
                    className={input + " max-w-xs"}
                    aria-label="Confirm authenticator code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Six-digit code"
                  />
                  <button className={button} disabled={busy}>
                    Confirm MFA
                  </button>
                </form>
              </div>
            )}
          </>
        )}
        {recovery.length > 0 && (
          <div className="p-4 bg-amber-50 rounded-xl text-sm">
            <h3 className="font-medium">Save these recovery codes now</h3>
            <p className="my-2 text-xs">
              Each code works once. They will not be displayed again.
            </p>
            <pre className="whitespace-pre-wrap break-all">
              {recovery.join("\n")}
            </pre>
            <button
              className={secondary + " mt-3"}
              onClick={() => setRecovery([])}
            >
              I saved my recovery codes
            </button>
          </div>
        )}
      </section>
      <section className="border bg-white rounded-xl p-6 space-y-4">
        <h2 className="font-semibold">Company SSO · OpenID Connect</h2>
        <p className="text-sm text-slate-500">
          {security.providerConfigured
            ? "The operator has configured an identity provider."
            : "The operator must configure OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET."}{" "}
          SSO requires Premium. Existing accounts must explicitly link their
          provider identity.
        </p>
        {role === "owner" && (
          <button
            className={secondary}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.patch(base + "/security", {
                  ssoEnabled: !security.ssoEnabled,
                });
                await load();
              })
            }
          >
            {security.ssoEnabled ? "Disable company SSO" : "Enable company SSO"}
          </button>
        )}
        <button
          className={button + " ml-2"}
          disabled={busy || !security.ssoEnabled}
          onClick={() =>
            void run(async () => {
              const { data } = await api.post(base + "/sso/link");
              location.href = data.url;
            })
          }
        >
          Link my SSO identity
        </button>
        <a className="block text-sm text-teal-700" href="/sso">
          Open company sign-in →
        </a>
      </section>
      {role === "owner" && (
        <section className="border bg-white rounded-xl p-6">
          <h2 className="font-semibold">Custom role restrictions</h2>
          <p className="text-sm text-slate-500 my-2">
            A custom role narrows a member’s base permissions. It cannot grant
            owner powers.
          </p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (editingRole)
                  await api.patch(base + "/roles/" + editingRole, {
                    name: roleName,
                    permissions,
                  });
                else
                  await api.post(base + "/roles", {
                    name: roleName,
                    permissions,
                  });
                setEditingRole("");
                setRoleName("");
                setPermissions([]);
                await load();
              }, "Custom role saved.");
            }}
          >
            <select
              className={input + " max-w-sm"}
              aria-label="Edit custom role"
              value={editingRole}
              onChange={(e) => {
                setEditingRole(e.target.value);
                const role = security.roles.find(
                  (r) => r._id === e.target.value,
                );
                setRoleName(role?.name || "");
                setPermissions(role?.permissions || []);
              }}
            >
              <option value="">Create a new role</option>
              {security.roles.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
            <input
              className={input + " max-w-sm"}
              required
              placeholder="Role name"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {security.permissions.map((p) => (
                <label className="text-xs" key={p}>
                  <input
                    type="checkbox"
                    checked={permissions.includes(p)}
                    onChange={(e) =>
                      setPermissions((old) =>
                        e.target.checked
                          ? [...old, p]
                          : old.filter((x) => x !== p),
                      )
                    }
                  />{" "}
                  {p}
                </label>
              ))}
            </div>
            <button className={button} disabled={busy}>
              {editingRole ? "Save role changes" : "Create restricted role"}
            </button>
            {editingRole && (
              <button
                type="button"
                className={secondary + " ml-2"}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.delete(base + "/roles/" + editingRole);
                    setEditingRole("");
                    setRoleName("");
                    setPermissions([]);
                    await load();
                  }, "Unused role deleted.")
                }
              >
                Delete unused role
              </button>
            )}
          </form>
          <div className="mt-6 space-y-3">
            {members
              .filter((m) => !["owner", "customer"].includes(m.role))
              .map((m) => (
                <label
                  key={m._id}
                  className="flex flex-wrap items-center gap-3 text-sm"
                >
                  <span className="flex-1">
                    {m.name || m.email} · {m.role}
                  </span>
                  <select
                    aria-label={`Custom role for ${m.email}`}
                    className={input + " max-w-xs"}
                    value={m.customRole || ""}
                    onChange={(e) =>
                      void run(async () => {
                        await api.patch(base + "/roles/assign/" + m._id, {
                          roleId: e.target.value || null,
                        });
                        await load();
                      })
                    }
                  >
                    <option value="">Base role only</option>
                    {security.roles.map((r) => (
                      <option key={r._id} value={r._id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
function ChannelsView({ workspaceId, run, busy }: Props) {
  const base = `/workspaces/${workspaceId}`;
  const [kind, setKind] = useState("email"),
    [name, setName] = useState(""),
    [token, setToken] = useState(""),
    [secret, setSecret] = useState(""),
    [asset, setAsset] = useState(""),
    [phone, setPhone] = useState(""),
    [forward, setForward] = useState(""),
    [host, setHost] = useState(""),
    [user, setUser] = useState(""),
    [password, setPassword] = useState(""),
    [connection, setConnection] = useState(""),
    [connections, setConnections] = useState<
      {
        _id: string;
        name: string;
        kind: string;
        lastSyncAt?: string;
        syncError?: string;
      }[]
    >([]),
    [result, setResult] = useState("");
  const load = useCallback(async () => {
    setConnections((await api.get(base + "/connectors")).data);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="space-y-5">
      <section className="bg-white border rounded-xl p-6">
        <h2 className="text-xl font-semibold">Support channels</h2>
        <p className="text-sm text-slate-500 my-3">
          Connect a mailbox, phone number or social account to your workspace
          inbox. Provider approvals and credentials are required.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {connections.map((c) => (
            <div key={c._id} className="border rounded-lg p-4">
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-slate-400 capitalize mt-1">
                {c.kind}{" "}
                {c.lastSyncAt
                  ? "· Synced " + new Date(c.lastSyncAt).toLocaleString()
                  : ""}
              </p>
              {c.syncError && (
                <p className="text-xs text-red-700 mt-2">{c.syncError}</p>
              )}
            </div>
          ))}
        </div>
      </section>
      <form
        className="bg-white border rounded-xl p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (kind === "email") {
              await api.put(base + "/connectors/" + connection + "/mailbox", {
                host,
                user,
                password,
                mailbox: "INBOX",
              });
              setPassword("");
              setResult(
                "Mailbox configured. The worker syncs up to 25 emails each minute.",
              );
            } else {
              const { data } = await api.post(base + "/channels", {
                kind,
                name,
                token,
                secret: kind === "phone" ? token : secret,
                assetId: asset,
                ...(kind === "phone"
                  ? { phoneNumber: phone, forwardTo: forward }
                  : {}),
              });
              setToken("");
              setSecret("");
              setResult(JSON.stringify(data, null, 2));
            }
            await load();
          }, "Channel configuration saved.");
        }}
      >
        <h3 className="font-semibold">Add or configure a channel</h3>
        <select
          className={input + " max-w-sm"}
          aria-label="Channel type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="email">Direct mailbox · IMAP (Pro)</option>
          <option value="phone">Phone · Twilio (Premium)</option>
          <option value="instagram">Instagram inbox (Premium)</option>
          <option value="messenger">Messenger inbox (Premium)</option>
        </select>
        {kind === "email" ? (
          <>
            <select
              className={input}
              required
              value={connection}
              onChange={(e) => setConnection(e.target.value)}
            >
              <option value="">Choose an existing email connection</option>
              {connections
                .filter((c) => c.kind === "email")
                .map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-400">
              Create an email connection under Connections first. The operator
              must allow your IMAP host. TLS port 993 is required.
            </p>
            <input
              className={input}
              required
              placeholder="IMAP hostname"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
            <input
              className={input}
              required
              placeholder="Mailbox username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
            <input
              className={input}
              required
              type="password"
              autoComplete="new-password"
              placeholder="App password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label className="block text-sm">
              Or import an .eml file after selecting a connection
              <input
                className="block mt-2 max-w-full"
                type="file"
                accept=".eml,message/rfc822"
                disabled={!connection}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void run(async () => {
                      await api.post(
                        base + "/connectors/" + connection + "/import-email",
                        file,
                        { headers: { "Content-Type": "message/rfc822" } },
                      );
                    }, "Email imported and attachments scanned.");
                }}
              />
            </label>
          </>
        ) : (
          <>
            <input
              required
              className={input}
              placeholder="Connection name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              required
              className={input}
              placeholder={
                kind === "phone"
                  ? "Twilio Account SID"
                  : "Provider account / page ID"
              }
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
            />
            <input
              required
              className={input}
              type="password"
              autoComplete="new-password"
              placeholder={
                kind === "phone" ? "Twilio Auth Token" : "Provider access token"
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            {kind !== "phone" && (
              <input
                required
                className={input}
                type="password"
                autoComplete="new-password"
                placeholder="App secret for signed webhooks"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            )}{" "}
            {kind === "phone" && (
              <>
                <input
                  required
                  className={input}
                  placeholder="Owned Twilio phone number (+91…)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <input
                  required
                  className={input}
                  placeholder="Agent phone destination (+91…)"
                  value={forward}
                  onChange={(e) => setForward(e.target.value)}
                />
                <p className="text-xs text-amber-700">
                  The provider charges for real calls. Incoming calls are logged
                  as tickets and forwarded to this agent number.
                </p>
              </>
            )}
          </>
        )}
        <button className={button} disabled={busy}>
          Save channel
        </button>
        {result && (
          <pre className="rounded-xl bg-slate-50 p-4 whitespace-pre-wrap break-all text-xs">
            {result}
          </pre>
        )}
      </form>
    </div>
  );
}
interface Invoice {
  _id: string;
  receipt: string;
  total: number;
  status: string;
  paidAt: string;
  plan: string;
  seats: number;
}
interface IndiaState {
  configured: boolean;
  prices: Record<string, number | null>;
  taxRateBps: number;
  invoices: Invoice[];
}
interface RazorpayInstance {
  open: () => void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n / 100,
  );
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
async function checkoutScript() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load payment checkout"));
    document.head.appendChild(script);
  });
}
function IndiaBilling({ workspaceId, role, run, busy }: Props) {
  const base = `/workspaces/${workspaceId}/billing/india`;
  const [data, setData] = useState<IndiaState | null>(null),
    [plan, setPlan] = useState("Pro"),
    [seats, setSeats] = useState(2),
    [name, setName] = useState(""),
    [address, setAddress] = useState(""),
    [stateCode, setStateCode] = useState(""),
    [stateName, setStateName] = useState(""),
    [gstin, setGstin] = useState("");
  const load = useCallback(async () => {
    setData((await api.get(base)).data);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  const net = (data?.prices[plan] || 0) * seats,
    tax = Math.round((net * (data?.taxRateBps || 0)) / 10000);
  return (
    <div className="space-y-5">
      <section className="border bg-white rounded-xl p-6">
        <h2 className="text-xl font-semibold">Indian billing</h2>
        <p className="text-sm text-slate-500 my-3">
          Pay for 30 days of workspace access through Razorpay. Available
          payment methods, including UPI, depend on your merchant account. This
          is prepaid access, not an automatic recurring debit.
        </p>
        {!data?.configured && (
          <p className="text-amber-700 text-sm">
            The operator must configure Razorpay, INR pricing and seller invoice
            details.
          </p>
        )}
        <form
          className="grid md:grid-cols-2 gap-4 mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await checkoutScript();
              const { data: order } = await api.post(base + "/orders", {
                plan,
                seats,
                customer: { name, address, stateCode, stateName, gstin },
                requestKey: crypto.randomUUID(),
              });
              const checkout = new window.Razorpay!({
                key: order.keyId,
                order_id: order.orderId,
                amount: order.amount,
                currency: order.currency,
                name: "QuickFix",
                description: `${plan} · ${seats} seats / 30 days`,
                handler: (response: {
                  razorpay_payment_id: string;
                  razorpay_signature: string;
                }) =>
                  void run(async () => {
                    await api.post(base + "/verify", {
                      id: order.id,
                      paymentId: response.razorpay_payment_id,
                      signature: response.razorpay_signature,
                    });
                    await load();
                  }, "Payment verified. Workspace access updated."),
              });
              checkout.open();
            });
          }}
        >
          <label className="text-sm">
            Plan
            <select
              className={input + " mt-1"}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              <option>Pro</option>
              <option>Premium</option>
            </select>
          </label>
          <label className="text-sm">
            Staff seats
            <input
              className={input + " mt-1"}
              type="number"
              min={1}
              max={1000}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
            />
          </label>
          <input
            required
            className={input}
            placeholder="Billing / company name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            required
            className={input}
            placeholder="Billing address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <input
            required
            className={input}
            placeholder="Place of supply: two-digit state code"
            pattern="\d{2}"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
          />
          <input
            required
            className={input}
            placeholder="State name"
            value={stateName}
            onChange={(e) => setStateName(e.target.value)}
          />
          <input
            className={input}
            placeholder="GSTIN (optional)"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
          />
          <div className="md:col-span-2 flex flex-wrap justify-between items-center gap-4 bg-teal-50 p-4 rounded-lg">
            <div>
              <p className="text-xs text-slate-500">
                {money(net)} + {money(tax)} tax
              </p>
              <p className="text-xl font-bold text-teal-900 mt-1">
                {money(net + tax)}{" "}
                <span className="text-xs font-normal">/ 30 days</span>
              </p>
            </div>
            <button
              className={button}
              disabled={
                busy ||
                !data?.configured ||
                !data.prices[plan] ||
                role !== "owner"
              }
            >
              Pay with Razorpay
            </button>
          </div>
          <p className="md:col-span-2 text-xs text-slate-400">
            Reducing seats suspends excess staff while preserving their data.
            Invoice tax fields use the seller’s configured tax rate and place of
            supply.
          </p>
        </form>
      </section>
      <section className="border bg-white rounded-xl p-6">
        <h3 className="font-semibold mb-4">Invoices and receipts</h3>
        {data?.invoices.map((row) => (
          <div
            className="flex flex-wrap gap-3 items-center border-t py-4 text-sm"
            key={row._id}
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium break-all">{row.receipt}</p>
              <p className="text-xs text-slate-400">
                {row.plan} · {row.seats} seats · {row.status}
              </p>
            </div>
            <span>{money(row.total)}</span>
            <button
              className={secondary}
              onClick={() =>
                void run(async () => {
                  const { data: i } = await api.get(
                    base + "/invoices/" + row._id,
                  );
                  const html = `<html><head><title>${escape(i.receipt)}</title><style>body{font:15px Arial;max-width:850px;margin:50px auto;padding:24px}td{padding:12px;border-bottom:1px solid #ddd}table{width:100%}h1{color:#0f766e}</style></head><body><h1>${escape(i.invoiceType)}</h1><p>${escape(i.invoiceNumber || i.receipt)} · ${escape(new Date(i.paidAt).toLocaleDateString())}</p><h3>${escape(i.seller.name)}</h3><p>${escape(i.seller.address)}<br>GSTIN: ${escape(i.seller.gstin || "—")}</p><h3>Bill to: ${escape(i.customer.name)}</h3><p>${escape(i.customer.address)}<br>GSTIN: ${escape(i.customer.gstin || "—")}<br>Place of supply: ${escape(i.customer.stateName)} (${escape(i.customer.stateCode)})</p><table><tr><td>${escape(i.description)}<br>SAC: ${escape(i.seller.sac || "—")}</td><td>${escape(money(i.net))}</td></tr>${[
                    "cgst",
                    "sgst",
                    "igst",
                  ]
                    .filter((k) => i[k])
                    .map(
                      (k) =>
                        `<tr><td>${k.toUpperCase()}</td><td>${escape(money(i[k]))}</td></tr>`,
                    )
                    .join(
                      "",
                    )}<tr><td><b>Total paid (INR)</b></td><td><b>${escape(money(i.total))}</b></td></tr></table><p>Tax rate: ${escape(i.taxRate / 100)}%. Reverse charge: No.</p><p>GST fields are a draft for accounting review. Add any required digital signature / IRN in your accounting workflow before issuing a tax invoice.</p><p>Payment: ${escape(i.paymentId)} · ${escape(i.status)}</p><button onclick="window.print()">Print / save PDF</button></body></html>`;
                  const url = URL.createObjectURL(
                    new Blob([html], { type: "text/html;charset=utf-8" }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download =
                    (i.invoiceNumber || i.receipt).replace(
                      /[^a-z0-9-]/gi,
                      "-",
                    ) + ".html";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              Download printable invoice
            </button>
          </div>
        ))}
        {!data?.invoices.length && (
          <p className="text-sm text-slate-400">No paid invoices yet.</p>
        )}
      </section>
    </div>
  );
}
function AIStudio({ workspaceId, run, busy }: Props) {
  const base = `/workspaces/${workspaceId}/ai`;
  const [state, setState] = useState<{
      enabled: boolean;
      configured: boolean;
      chunks: number;
      evaluations: {
        _id: string;
        question: string;
        answer: string;
        supported: boolean;
        score: number;
      }[];
    }>({ enabled: false, configured: false, chunks: 0, evaluations: [] }),
    [question, setQuestion] = useState(""),
    [results, setResults] = useState<
      { title: string; text: string; score: number }[]
    >([]);
  const load = useCallback(async () => {
    setState((await api.get(base + "/settings")).data);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="space-y-5">
      <section className="bg-white border rounded-xl p-6 space-y-4">
        <h2 className="text-xl font-semibold">AI studio</h2>
        <p className="text-sm text-slate-500">
          Semantic search uses embeddings from published company articles. The
          optional FAQ assistant answers only supported questions, includes
          sources and hands uncertain or sensitive requests to a human.
        </p>
        <p className="text-sm">
          Embedding provider:{" "}
          {state.configured ? "configured" : "needs operator setup"} · Indexed
          chunks: {state.chunks}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.post(base + "/index");
              }, "Indexing queued. Check delivery jobs and refresh when complete.")
            }
          >
            Index published knowledge
          </button>
          <button className={secondary} onClick={() => void run(load)}>
            Refresh index status
          </button>
          <button
            className={secondary}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.patch(base + "/settings", {
                  enabled: !state.enabled,
                });
                await load();
              })
            }
          >
            {state.enabled
              ? "Disable customer FAQ assistant"
              : "Enable customer FAQ assistant"}
          </button>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setResults((await api.post(base + "/search", { question })).data);
            });
          }}
        >
          <input
            required
            className={input + " flex-1"}
            placeholder="Test a customer question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className={secondary}>Search company knowledge</button>
        </form>
        {results.map((r, i) => (
          <div className="p-4 bg-slate-50 rounded-lg" key={i}>
            <p className="font-medium text-sm">{r.title}</p>
            <p className="text-xs text-slate-400 my-2">
              Similarity {r.score.toFixed(3)} · not an accuracy probability
            </p>
            <p className="text-sm whitespace-pre-wrap">{r.text}</p>
          </div>
        ))}
      </section>
      <section className="bg-white border rounded-xl p-6">
        <h3 className="font-semibold">Recent answer evaluations</h3>
        {state.evaluations.map((e) => (
          <div className="py-4 border-t mt-3" key={e._id}>
            <p className="font-medium text-sm">{e.question}</p>
            <p className="text-xs text-slate-400 my-2">
              {e.supported ? "Evidence check passed" : "Handed to support"} ·
              retrieval similarity {e.score?.toFixed(3)}
            </p>
            <p className="text-sm">{e.answer || "No automated answer sent."}</p>
          </div>
        ))}
        {!state.evaluations.length && (
          <p className="text-sm text-slate-400 mt-3">
            Evaluations appear when customers use the FAQ assistant. Automated
            checks reduce unsupported answers; they do not guarantee
            correctness.
          </p>
        )}
      </section>
    </div>
  );
}
function MigrationView({ workspaceId, run, busy }: Props) {
  const base = `/workspaces/${workspaceId}/migration`;
  const [rows, setRows] = useState<
      { _id: string; title: string; status: string }[]
    >([]),
    [ids, setIds] = useState<string[]>([]),
    [preview, setPreview] = useState<
      {
        id: string;
        title: string;
        alreadyImported: boolean;
        attachmentsRequiringRescan: number;
      }[]
    >([]),
    [confirmed, setConfirmed] = useState(false),
    [result, setResult] = useState("");
  useEffect(() => {
    void run(async () => {
      setRows((await api.get(base + "/candidates")).data);
    });
  }, [base, run]);
  return (
    <section className="border bg-white rounded-xl p-6 space-y-4">
      <h2 className="text-xl font-semibold">Import existing complaints</h2>
      <p className="text-sm text-slate-500">
        Choose records, preview the mapping, then confirm. Source complaints
        remain unchanged. Only a global admin can import other customers’
        complaints. Legacy files need scanned re-upload; login credentials and
        old subscriptions are not copied.
      </p>
      <div className="max-h-80 overflow-auto border rounded-lg divide-y">
        {rows.map((r) => (
          <label key={r._id} className="flex gap-3 p-3 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(r._id)}
              onChange={(e) => {
                setIds((old) =>
                  e.target.checked
                    ? [...old, r._id]
                    : old.filter((id) => id !== r._id),
                );
                setPreview([]);
                setConfirmed(false);
              }}
            />
            <span>
              {r.title} <span className="text-slate-400">· {r.status}</span>
            </span>
          </label>
        ))}
      </div>
      <button
        className={secondary}
        disabled={!ids.length || busy}
        onClick={() =>
          void run(async () => {
            setPreview((await api.post(base + "/preview", { ids })).data);
          })
        }
      >
        Preview selected records
      </button>
      {preview.length > 0 && (
        <>
          <div className="space-y-2">
            {preview.map((p) => (
              <p key={p.id} className="text-sm">
                {p.title} ·{" "}
                {p.alreadyImported ? "Already imported" : "Ready to import"} ·{" "}
                {p.attachmentsRequiringRescan} files requiring re-upload
              </p>
            ))}
          </div>
          <label className="block text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I reviewed the records and authorize importing them into this
            workspace.
          </label>
          <button
            className={button}
            disabled={!confirmed || busy}
            onClick={() =>
              void run(async () => {
                const { data } = await api.post(base + "/import", {
                  ids,
                  confirmed,
                });
                setResult(
                  `${data.results.length} records processed. ${data.notice}`,
                );
                setPreview([]);
                setIds([]);
              }, "Migration completed.")
            }
          >
            Import into this workspace
          </button>
        </>
      )}
      {result && (
        <p className="rounded-lg bg-emerald-50 text-emerald-800 p-4 text-sm">
          {result}
        </p>
      )}
    </section>
  );
}
function ReadinessView({ workspaceId, run }: Props) {
  const [data, setData] = useState<{
    ready: boolean;
    components: Record<string, boolean>;
    providers: Record<string, boolean>;
    entitlement: { plan: string; seats: number; features: string[] };
  } | null>(null);
  const load = useCallback(async () => {
    setData((await api.get(`/workspaces/${workspaceId}/readiness`)).data);
  }, [workspaceId]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <section className="border bg-white rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-xl font-semibold">Deployment readiness</h2>
        <button className={secondary} onClick={() => void run(load)}>
          Check again
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Live checks for your API, persistent worker, transactional database and
        malware scanner. Provider flags indicate configuration only; they do not
        certify a live integration.
      </p>
      {data && (
        <>
          <p
            className={`font-medium ${data.ready ? "text-emerald-700" : "text-amber-700"}`}
          >
            {data.ready
              ? "Core services are ready"
              : "Some core services need operator setup"}
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {Object.entries({ ...data.components, ...data.providers }).map(
              ([name, ready]) => (
                <div
                  className="p-4 bg-slate-50 rounded-lg flex items-center gap-3"
                  key={name}
                >
                  {ready ? (
                    <CheckCircle2 size={20} className="text-emerald-600" />
                  ) : (
                    <AlertCircle size={20} className="text-amber-600" />
                  )}
                  <span className="text-sm capitalize">
                    {name.replace(/([A-Z])/g, " $1")}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {ready ? "Configured / healthy" : "Needs setup"}
                  </span>
                </div>
              ),
            )}
          </div>
          <div className="p-4 bg-teal-50 rounded-lg">
            <p className="font-medium text-sm">
              {data.entitlement.plan} · {data.entitlement.seats} staff seats
            </p>
            <p className="text-xs text-teal-800 mt-2">
              Features: {data.entitlement.features.join(", ")}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
export function PublicFAQ({ slug }: { slug: string }) {
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<{
      answer?: string;
      message?: string;
      handoff: boolean;
      sources: { citation: number; title: string; slug: string }[];
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="bg-white border rounded-xl p-5 my-5">
      <h3 className="font-semibold">Ask our knowledge assistant</h3>
      <p className="text-xs text-slate-400 mt-2">
        AI answers from this company’s published articles. For account or order
        questions, contact support.
      </p>
      <form
        className="flex flex-wrap gap-2 mt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            setAnswer(
              (await api.post("/help/" + slug + "/ask", { question })).data,
            );
          } catch (e) {
            setMessage(error(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          required
          minLength={3}
          maxLength={1000}
          className={input + " flex-1"}
          placeholder="Ask a general product or service question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className={button} disabled={busy}>
          {busy ? "Checking articles…" : "Ask"}
        </button>
      </form>
      {message && <p className="text-sm text-amber-800 mt-3">{message}</p>}
      {answer && (
        <div className="mt-4 text-sm space-y-2">
          <p className="whitespace-pre-wrap">
            {answer.answer || answer.message}
          </p>
          {answer.sources.map((s) => (
            <a
              className="block text-teal-700"
              href={
                "/support/" + slug + "?article=" + encodeURIComponent(s.slug)
              }
              key={s.citation}
            >
              [{s.citation}] {s.title}
            </a>
          ))}
          <p className="text-xs text-slate-400">
            AI-generated response. Verify with support if unsure.
          </p>
        </div>
      )}
    </section>
  );
}
export function TicketChannelActions({
  base,
  ticketId,
  channel,
  run,
}: {
  base: string;
  ticketId: string;
  channel: string;
  run: Run;
}) {
  const [name, setName] = useState(""),
    [language, setLanguage] = useState("en"),
    [parameters, setParameters] = useState(""),
    [file, setFile] = useState(""),
    [caption, setCaption] = useState(""),
    [connection, setConnection] = useState(""),
    [external, setExternal] = useState(""),
    [verified, setVerified] = useState(false),
    [files, setFiles] = useState<{ _id: string; name: string }[]>([]);
  useEffect(() => {
    api
      .get(`${base}/tickets/${ticketId}/attachments`)
      .then((r) => setFiles(r.data))
      .catch(() => {});
  }, [base, ticketId]);
  return (
    <details className="border-t pt-4 mt-5 text-sm">
      <summary className="cursor-pointer text-slate-500">
        Phone, WhatsApp and customer identity
      </summary>
      <div className="space-y-3 mt-4">
        <button
          className={secondary}
          onClick={() =>
            void run(async () => {
              await api.post(`${base}/tickets/${ticketId}/call`);
            }, "Phone call initiated. Provider charges apply.")
          }
        >
          Call customer through the connected phone provider
        </button>
        {channel === "whatsapp" && (
          <>
            <h4 className="font-medium">Send an approved WhatsApp template</h4>
            <input
              className={input}
              placeholder="Approved template name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={input}
              placeholder="Language code (en, hi, en_US)"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
            <textarea
              className={input}
              placeholder="Body parameters, one per line"
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
            />
            <button
              className={secondary}
              disabled={!name}
              onClick={() =>
                void run(async () => {
                  await api.post(`${base}/tickets/${ticketId}/whatsapp`, {
                    template: {
                      name,
                      language,
                      parameters: parameters ? parameters.split("\n") : [],
                    },
                  });
                }, "WhatsApp template queued.")
              }
            >
              Queue approved template
            </button>
            <h4 className="font-medium">Send a scanned attachment</h4>
            <select
              className={input}
              value={file}
              onChange={(e) => setFile(e.target.value)}
            >
              <option value="">Select an uploaded public attachment</option>
              {files.map((f) => (
                <option value={f._id} key={f._id}>
                  {f.name}
                </option>
              ))}
            </select>
            <input
              className={input}
              placeholder="Caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <button
              className={secondary}
              disabled={!file}
              onClick={() =>
                void run(async () => {
                  await api.post(`${base}/tickets/${ticketId}/whatsapp`, {
                    attachmentId: file,
                    caption,
                  });
                }, "WhatsApp attachment queued.")
              }
            >
              Send attachment
            </button>
          </>
        )}
        <h4 className="font-medium pt-3">
          Link a verified customer across channels
        </h4>
        <p className="text-xs text-slate-400">
          Use only after independently verifying that the phone or social
          identity belongs to this ticket’s customer. Existing conversations for
          that identity will be linked.
        </p>
        <input
          className={input}
          placeholder="Connection ID (from Connections)"
          value={connection}
          onChange={(e) => setConnection(e.target.value)}
        />
        <input
          className={input}
          placeholder="Customer phone digits or provider sender ID"
          value={external}
          onChange={(e) => setExternal(e.target.value)}
        />
        <label className="block">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />{" "}
          I verified this customer identity
        </label>
        <button
          className={secondary}
          disabled={!verified || !connection || !external}
          onClick={() =>
            void run(async () => {
              await api.post(`${base}/tickets/${ticketId}/channel-identity`, {
                connectorId: connection,
                externalCustomer: external,
                identityVerified: true,
              });
            }, "Channel identity linked and audited.")
          }
        >
          Link channel identity
        </button>
      </div>
    </details>
  );
}
