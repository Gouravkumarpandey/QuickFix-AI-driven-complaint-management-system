import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";
import { useAuth } from "../../hooks/useAuth";
import {
  Inbox,
  BookOpen,
  Users,
  Settings,
  Plug,
  CreditCard,
  BarChart3,
  ArrowLeft,
  Plus,
  Send,
  RefreshCw,
  Sparkles,
} from "lucide-react";
interface Field {
  key: string;
  label: string;
  type: "text" | "number" | "dropdown" | "checkbox";
  required: boolean;
  options?: string[];
}
interface Workspace {
  _id: string;
  name: string;
  slug: string;
  role: string;
  settings: {
    timezone: string;
    language: string;
    publicPortal: boolean;
    statuses: string[];
    pauseStatuses: string[];
    customFields: Field[];
    businessHours: {
      days: number[];
      start: string;
      end: string;
      holidays: string[];
    };
    sla: {
      firstResponse: number;
      nextResponse: number;
      resolution: number;
      businessHours: boolean;
    };
  };
  billing: { plan: string; seats: number; expiresAt?: string };
}
interface Member {
  _id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  capacity: number;
  groups: string[];
  skills: string[];
  online: boolean;
}
interface Contact {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  notes?: string;
}
interface Ticket {
  _id: string;
  number: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  channel: string;
  version: number;
  guest?: boolean;
  guestVerified?: boolean;
  assignedTo?: Member | string;
  contact: Contact | string;
  sla: { firstDue?: string; resolutionDue?: string; breached: boolean };
}
interface Message {
  _id: string;
  text: string;
  author: string;
  authorRole: string;
  internal: boolean;
  createdAt: string;
  delivery: string;
}
interface Article {
  _id: string;
  title: string;
  slug: string;
  body: string;
  category: string;
  language: string;
  published: boolean;
}
interface Resource {
  _id: string;
  name: string;
  kind: string;
  value: {
    text?: string;
    actions?: { priority?: string; status?: string; reply?: string };
    status?: string;
    priority?: string;
    event?: string;
  };
}
const control =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none";
const button =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
const secondary =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
const errorText = (error: unknown) => {
  const value = error as {
    response?: { data?: { error?: string; message?: string } };
    message?: string;
  };
  return (
    value.response?.data?.error ||
    value.response?.data?.message ||
    value.message ||
    "Please try again."
  );
};
const date = (value?: string) =>
  value ? new Date(value).toLocaleString() : "—";
export function WorkspaceConsole() {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [selected, setSelected] = useState(""),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [member, setMember] = useState<Member | null>(null),
    [tab, setTab] = useState("Inbox"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [invite, setInvite] = useState(
      new URLSearchParams(location.search).get("invite") || "",
    );
  const refresh = useCallback(async () => {
    const { data } = await api.get<{ workspaces: Workspace[] }>("/workspaces");
    setWorkspaces(data.workspaces);
    setSelected((old) =>
      data.workspaces.some((item) => item._id === old)
        ? old
        : data.workspaces[0]?._id || "",
    );
  }, []);
  const run = useCallback(async (action: () => Promise<void>, success = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void run(refresh);
  }, [refresh, run]);
  useEffect(() => {
    let active = true;
    setWorkspace(null);
    setMember(null);
    if (selected)
      api
        .get<{ workspace: Workspace; member: Member }>(
          `/workspaces/${selected}`,
        )
        .then(({ data }) => {
          if (active) {
            setWorkspace(data.workspace);
            setMember(data.member);
            setTab(data.member.role === "analyst" ? "Reports" : "Inbox");
          }
        })
        .catch((error) => {
          if (active) setError(errorText(error));
        });
    return () => {
      active = false;
    };
  }, [selected]);
  const reloadWorkspace = async () => {
    if (!selected) return;
    const { data } = await api.get<{ workspace: Workspace; member: Member }>(
      `/workspaces/${selected}`,
    );
    setWorkspace(data.workspace);
    setMember(data.member);
  };
  const manage = member && ["owner", "admin"].includes(member.role),
    staff = member && member.role !== "customer",
    work = member && ["owner", "admin", "agent"].includes(member.role);
  const tabs = [
    ["Inbox", Inbox],
    ["Knowledge base", BookOpen],
    ["Customers", Users],
    ["Tools", Sparkles],
    ["Team", Users],
    ["Settings", Settings],
    ["Connections", Plug],
    ["Billing", CreditCard],
    ["Reports", BarChart3],
  ] as const;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="text-slate-400"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={19} />
          </Link>
          <div className="rounded-xl bg-blue-600 p-2 text-white">
            <Inbox size={22} />
          </div>
          <div>
            <h1 className="font-bold text-lg">QuickFix Helpdesk</h1>
            <p className="text-xs text-slate-500">
              Your team. Your customers. One inbox.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            className={control}
            aria-label="Select workspace"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose workspace</option>
            {workspaces.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </select>
          <span className="hidden md:block text-sm text-slate-500 whitespace-nowrap">
            {user?.name}
          </span>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="m-4 rounded-lg bg-red-50 border border-red-200 p-3 text-red-800 text-sm"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="m-4 rounded-lg bg-green-50 p-3 text-green-800 text-sm"
        >
          {notice}
        </div>
      )}
      <main className="max-w-[1500px] mx-auto p-4 md:p-6">
        {invite && (
          <section className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
            <h2 className="font-semibold">You have a workspace invitation</h2>
            <p className="text-sm my-2">
              Accept using the account registered with the invited email
              address.
            </p>
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                void run(async () => {
                  await api.post("/workspaces/invites/accept", {
                    token: invite,
                  });
                  setInvite("");
                  await refresh();
                  history.replaceState(null, "", "/workspaces");
                }, "Invitation accepted.")
              }
            >
              Accept invitation
            </button>
          </section>
        )}
        {!workspaces.length && (
          <section className="mx-auto max-w-lg bg-white border rounded-2xl p-8 my-10">
            <h2 className="text-2xl font-bold">
              Create your company workspace
            </h2>
            <p className="text-slate-500 my-3">
              Keep your customer conversations, team, articles and reporting
              together. Your free workspace includes two staff seats.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const { data } = await api.post<Workspace>("/workspaces", {
                    name,
                    slug,
                  });
                  await refresh();
                  setSelected(data._id);
                }, "Workspace created.");
              }}
              className="space-y-3"
            >
              <label className="block text-sm">
                Company name
                <input
                  required
                  minLength={2}
                  className={control}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSlug(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                    );
                  }}
                />
              </label>
              <label className="block text-sm">
                Help centre address
                <input
                  required
                  pattern="[a-z0-9][a-z0-9-]{2,49}"
                  className={control}
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                />
                <span className="text-xs text-slate-400">
                  /support/{slug || "your-company"}
                </span>
              </label>
              <button disabled={busy} className={button}>
                Create workspace
              </button>
            </form>
          </section>
        )}
        {workspace && member && (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              {tabs
                .filter(([label]) =>
                  label === "Inbox"
                    ? member.role !== "analyst"
                    : label === "Knowledge base"
                      ? staff
                      : label === "Customers"
                        ? work
                        : label === "Tools"
                          ? staff
                          : [
                                "Team",
                                "Settings",
                                "Connections",
                                "Billing",
                              ].includes(label)
                            ? manage
                            : ["owner", "admin", "analyst"].includes(
                                member.role,
                              ),
                )
                .map(([label, Icon]) => (
                  <button
                    key={label}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${tab === label ? "bg-slate-900 text-white" : "bg-white text-slate-500 border"}`}
                    onClick={() => {
                      setTab(label);
                      setError("");
                      setNotice("");
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              <a
                className={`${secondary} ml-auto`}
                href={`/support/${workspace.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                Open help centre ↗
              </a>
            </div>
            {tab === "Inbox" && member.role !== "analyst" && (
              <InboxView
                key={workspace._id}
                workspace={workspace}
                member={member}
                run={run}
                busy={busy}
              />
            )}
            {tab === "Knowledge base" && staff && (
              <KnowledgeView
                key={workspace._id}
                workspace={workspace}
                manage={Boolean(manage)}
                run={run}
                busy={busy}
              />
            )}
            {tab === "Customers" && work && (
              <ContactsView workspace={workspace} run={run} />
            )}
            {tab === "Tools" && staff && (
              <ToolsView
                workspace={workspace}
                manage={Boolean(manage)}
                run={run}
                busy={busy}
              />
            )}
            {tab === "Team" && manage && (
              <TeamView
                workspace={workspace}
                role={member.role}
                run={run}
                busy={busy}
              />
            )}
            {tab === "Settings" && manage && (
              <SettingsView
                workspace={workspace}
                run={run}
                busy={busy}
                refresh={reloadWorkspace}
              />
            )}
            {tab === "Connections" && manage && (
              <ConnectionsView workspace={workspace} run={run} busy={busy} />
            )}
            {tab === "Billing" && manage && (
              <BillingView
                workspace={workspace}
                owner={member.role === "owner"}
                run={run}
                busy={busy}
                refresh={reloadWorkspace}
              />
            )}
            {tab === "Reports" &&
              ["owner", "admin", "analyst"].includes(member.role) && (
                <ReportsView workspace={workspace} run={run} />
              )}
          </>
        )}
        {workspaces.length > 0 && (
          <details className="mt-8 text-sm text-slate-500">
            <summary className="cursor-pointer">
              Create another workspace
            </summary>
            <form
              className="flex flex-wrap gap-2 mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const { data } = await api.post<Workspace>("/workspaces", {
                    name,
                    slug,
                  });
                  await refresh();
                  setSelected(data._id);
                });
              }}
            >
              <input
                required
                className={control + " max-w-xs"}
                placeholder="Company name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <input
                required
                className={control + " max-w-xs"}
                placeholder="Unique help centre address"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
              <button className={button} disabled={busy}>
                Create
              </button>
            </form>
          </details>
        )}
      </main>
    </div>
  );
}
type Run = (action: () => Promise<void>, success?: string) => Promise<void>;
function InboxView({
  workspace,
  member,
  run,
  busy,
}: {
  workspace: Workspace;
  member: Member;
  run: Run;
  busy: boolean;
}) {
  const base = `/workspaces/${workspace._id}`;
  const [tickets, setTickets] = useState<Ticket[]>([]),
    [selected, setSelected] = useState(""),
    [ticket, setTicket] = useState<Ticket | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [reply, setReply] = useState(""),
    [internal, setInternal] = useState(false),
    [creating, setCreating] = useState(false),
    [subject, setSubject] = useState(""),
    [description, setDescription] = useState(""),
    [email, setEmail] = useState(""),
    [fields, setFields] = useState<Record<string, unknown>>({}),
    [draft, setDraft] = useState(""),
    [sources, setSources] = useState<
      { citation: number; title: string; slug: string }[]
    >([]),
    [language, setLanguage] = useState("en"),
    [macros, setMacros] = useState<Resource[]>([]),
    [views, setViews] = useState<Resource[]>([]),
    [view, setView] = useState(""),
    [mergeTarget, setMergeTarget] = useState(""),
    [viewers, setViewers] = useState<{ name: string }[]>([]),
    [orderId, setOrderId] = useState(""),
    [awb, setAwb] = useState(""),
    [orderInfo, setOrderInfo] = useState<{
      orders: {
        name: string;
        fulfillmentStatus: string;
        paymentStatus: string;
      }[];
      tracking: { status: string; estimatedDelivery?: string } | null;
    } | null>(null),
    [files, setFiles] = useState<{ _id: string; name: string }[]>([]);
  const staff = member.role !== "customer";
  const load = useCallback(async () => {
    const { data } = await api.get<{ tickets: Ticket[] }>(base + "/tickets", {
      params: {
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(view ? { view } : {}),
      },
    });
    setTickets(data.tickets);
  }, [base, search, status, view]);
  useEffect(() => {
    void run(load);
  }, [run, load]);
  useEffect(() => {
    if (!staff) return;
    let active = true;
    Promise.all([
      api.get<Member[]>(base + "/members"),
      api.get<Resource[]>(base + "/resources/macro"),
      api.get<Resource[]>(base + "/resources/view"),
    ])
      .then(([a, b, c]) => {
        if (active) {
          setMembers(a.data);
          setMacros(b.data);
          setViews(c.data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [base, staff]);
  const detail = useCallback(async () => {
    if (!selected) return;
    const { data } = await api.get<{ ticket: Ticket; messages: Message[] }>(
      `${base}/tickets/${selected}`,
    );
    setTicket(data.ticket);
    setMessages(data.messages);
    const attachments = await api.get<{ _id: string; name: string }[]>(
      `${base}/tickets/${selected}/attachments`,
    );
    setFiles(attachments.data);
  }, [base, selected]);
  useEffect(() => {
    setTicket(null);
    setDraft("");
    setReply("");
    if (!selected) return;
    let active = true;
    const refresh = async () => {
      try {
        const { data } = await api.get<{ ticket: Ticket; messages: Message[] }>(
          `${base}/tickets/${selected}`,
        );
        if (active) {
          setTicket(data.ticket);
          setMessages(data.messages);
          if (staff) {
            const presence = await api.post<{ name: string }[]>(
              `${base}/tickets/${selected}/presence`,
            );
            if (active) setViewers(presence.data);
          }
        }
      } catch {}
    };
    void run(detail);
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base, selected, detail, run]);
  const patch = (value: Record<string, unknown>) =>
    run(async () => {
      await api.patch(`${base}/tickets/${selected}`, {
        ...value,
        expectedVersion: ticket?.version,
      });
      await detail();
      await load();
    });
  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5">
      <section className="bg-white border rounded-xl overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Support inbox</h2>
          <button className={secondary} onClick={() => setCreating(!creating)}>
            <Plus size={16} />
            <span className="sr-only">New ticket</span>
          </button>
        </div>
        <div className="p-3 space-y-2">
          <input
            className={control}
            placeholder="Search tickets"
            aria-label="Search tickets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex gap-2">
            <select
              className={control}
              aria-label="Filter status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {workspace.settings.statuses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            {staff && (
              <select
                aria-label="Saved view"
                className={control}
                value={view}
                onChange={(event) => setView(event.target.value)}
              >
                <option value="">Saved views</option>
                {views.map((item) => (
                  <option value={item._id} key={item._id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="divide-y max-h-[680px] overflow-auto">
          {tickets.length === 0 && (
            <p className="p-8 text-sm text-slate-400">
              No tickets match this view. Create a ticket or connect an incoming
              channel.
            </p>
          )}
          {tickets.map((item) => (
            <button
              key={item._id}
              onClick={() => setSelected(item._id)}
              className={`block w-full text-left p-4 hover:bg-blue-50 ${selected === item._id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}
            >
              <div className="text-xs text-slate-400 flex justify-between">
                <span>{item.number}</span>
                <span>{item.channel}</span>
              </div>
              <h3 className="font-medium text-sm my-2">{item.subject}</h3>
              <div className="flex gap-2 text-xs">
                <span className="bg-slate-100 px-2 py-1 rounded">
                  {item.status}
                </span>
                <span
                  className={
                    item.priority === "Critical"
                      ? "text-red-600"
                      : "text-slate-500"
                  }
                >
                  {item.priority}
                </span>
                {item.sla.breached && (
                  <span className="text-red-600">SLA breached</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="bg-white border rounded-xl p-5 min-h-[600px]">
        {creating ? (
          <form
            className="space-y-4 max-w-xl"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const { data } = await api.post<Ticket>(base + "/tickets", {
                  subject,
                  description,
                  ...(email ? { email } : {}),
                  customFields: fields,
                });
                setCreating(false);
                setSubject("");
                setDescription("");
                setEmail("");
                setFields({});
                await load();
                setSelected(data._id);
              }, "Ticket created.");
            }}
          >
            <h2 className="text-xl font-semibold">New support ticket</h2>
            {staff && (
              <label className="block text-sm">
                Customer email
                <input
                  type="email"
                  className={control}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            )}
            <label className="block text-sm">
              Subject
              <input
                required
                minLength={3}
                className={control}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              How can we help?
              <textarea
                required
                minLength={3}
                rows={5}
                className={control}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <CustomFields
              fields={workspace.settings.customFields}
              values={fields}
              onChange={setFields}
            />
            <div className="flex gap-2">
              <button disabled={busy} className={button}>
                Create ticket
              </button>
              <button
                type="button"
                className={secondary}
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : ticket ? (
          <>
            <div className="border-b pb-4">
              <p className="text-xs text-blue-600 mb-2">
                {ticket.number} · {ticket.channel}
              </p>
              <h2 className="text-xl font-semibold">{ticket.subject}</h2>
              {viewers.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  Also viewing:{" "}
                  {viewers.map((viewer) => viewer.name).join(", ")}. Refresh
                  before changing ticket details.
                </p>
              )}
              <div className="flex flex-wrap gap-3 mt-4">
                {staff ? (
                  <>
                    <select
                      aria-label="Ticket status"
                      className={control + " max-w-[180px]"}
                      value={ticket.status}
                      onChange={(event) =>
                        void patch({ status: event.target.value })
                      }
                    >
                      {workspace.settings.statuses.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Ticket priority"
                      className={control + " max-w-[120px]"}
                      value={ticket.priority}
                      onChange={(event) =>
                        void patch({ priority: event.target.value })
                      }
                    >
                      {["Low", "Medium", "High", "Critical"].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Assigned agent"
                      className={control + " max-w-[200px]"}
                      value={
                        typeof ticket.assignedTo === "string"
                          ? ticket.assignedTo
                          : ticket.assignedTo?._id || ""
                      }
                      onChange={(event) =>
                        void patch({ assignedTo: event.target.value || null })
                      }
                    >
                      <option value="">Automatic assignment</option>
                      {members
                        .filter(
                          (item) =>
                            item.active &&
                            ["owner", "admin", "agent"].includes(item.role),
                        )
                        .map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.name || item.email}
                          </option>
                        ))}
                    </select>
                  </>
                ) : (
                  <span className="text-sm bg-blue-50 px-3 py-1 rounded">
                    {ticket.status}
                  </span>
                )}
              </div>
              {staff && ticket.guest && !ticket.guestVerified && (
                <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-800">
                  This guest email is not verified. Verify identity before
                  sharing order details or merging conversations.{" "}
                  <button
                    className="underline ml-2"
                    onClick={() =>
                      void run(async () => {
                        await api.post(
                          `${base}/tickets/${selected}/verify-customer`,
                        );
                      }, "Verification email queued. The customer must open the emailed link.")
                    }
                  >
                    Send verification email
                  </button>
                </div>
              )}
              <p className="text-xs text-slate-400 mt-3">
                First response due: {date(ticket.sla.firstDue)} · Resolution
                due: {date(ticket.sla.resolutionDue)}
              </p>
            </div>
            <div className="space-y-3 py-5 max-h-[420px] overflow-auto">
              {messages.map((message) => (
                <div
                  key={message._id}
                  className={`rounded-xl p-4 ${message.internal ? "bg-amber-50 border border-amber-100" : message.authorRole === "customer" ? "bg-slate-50" : "bg-blue-50"}`}
                >
                  <div className="text-xs text-slate-500 mb-2 flex justify-between">
                    <span>
                      {message.internal ? "Private note · " : ""}
                      {message.authorRole}
                    </span>
                    <span>{date(message.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                  {["queued", "failed"].includes(message.delivery) && (
                    <p className="text-xs text-amber-700 mt-2">
                      Delivery {message.delivery}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  async () => {
                    await api.post(`${base}/tickets/${selected}/messages`, {
                      text: reply,
                      internal,
                    });
                    setReply("");
                    await detail();
                    await load();
                  },
                  internal ? "Private note saved." : "Reply saved.",
                );
              }}
              className="space-y-3 border-t pt-4"
            >
              <div className="flex flex-wrap gap-2 items-center">
                {staff && (
                  <>
                    <label className="text-sm">
                      <input
                        type="checkbox"
                        checked={internal}
                        onChange={(event) => setInternal(event.target.checked)}
                      />{" "}
                      Private note
                    </label>
                    <CannedSelect base={base} select={setReply} />
                    <select
                      aria-label="Apply macro"
                      className={control + " max-w-[180px]"}
                      value=""
                      onChange={(event) =>
                        void run(async () => {
                          await api.post(
                            `${base}/tickets/${selected}/macros/${event.target.value}`,
                          );
                          await detail();
                          await load();
                        }, "Macro applied.")
                      }
                    >
                      <option value="">Apply macro…</option>
                      {macros.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <textarea
                required
                rows={4}
                maxLength={10000}
                className={control}
                placeholder={
                  internal
                    ? "Only your support team can see this note."
                    : "Write your response…"
                }
                value={reply}
                onChange={(event) => setReply(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button className={button} disabled={busy || !reply.trim()}>
                  <span className="flex gap-2 items-center">
                    <Send size={15} />
                    {internal ? "Save note" : "Send reply"}
                  </span>
                </button>
                {staff && (
                  <>
                    <select
                      aria-label="AI draft language"
                      className={control + " max-w-[110px]"}
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                    >
                      {["en", "hi", "hinglish", "bn", "ta", "te", "mr"].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                    <button
                      type="button"
                      className={secondary}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { data } = await api.post<{
                            draft: string | null;
                            sources: typeof sources;
                            message?: string;
                          }>(`${base}/tickets/${selected}/ai-draft`, {
                            language,
                          });
                          setDraft(
                            data.draft || data.message || "No supported draft.",
                          );
                          setSources(data.sources);
                        })
                      }
                    >
                      Draft from knowledge base
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={secondary}
                  onClick={() => void run(detail)}
                  aria-label="Refresh conversation"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </form>
            {draft && (
              <div className="my-4 bg-violet-50 rounded-xl p-4 text-sm">
                <h3 className="font-medium mb-2">
                  Review this AI suggestion before sending
                </h3>
                <p className="whitespace-pre-wrap">{draft}</p>
                <ul className="text-xs my-2">
                  {sources.map((source) => (
                    <li key={source.citation}>
                      [{source.citation}] {source.title}
                    </li>
                  ))}
                </ul>
                {sources.length > 0 && (
                  <button className={secondary} onClick={() => setReply(draft)}>
                    Use as draft
                  </button>
                )}
              </div>
            )}
            <div className="border-t mt-5 pt-4">
              <h3 className="text-sm font-medium mb-2">Attachments</h3>
              <input
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                aria-label="Upload attachment"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void run(async () => {
                      await api.post(
                        `${base}/tickets/${selected}/attachments`,
                        file,
                        {
                          headers: {
                            "Content-Type": "application/octet-stream",
                            "X-File-Name": encodeURIComponent(file.name),
                            "X-Attachment-Visibility": internal
                              ? "internal"
                              : "public",
                          },
                        },
                      );
                      await detail();
                    }, "File scanned and uploaded.");
                }}
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {files.map((file) => (
                  <button
                    className={secondary}
                    key={file._id}
                    onClick={() =>
                      void run(async () => {
                        const { data } = await api.get<Blob>(
                          `${base}/tickets/${selected}/attachments/${file._id}`,
                          { responseType: "blob" },
                        );
                        download(data, file.name);
                      })
                    }
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </div>
            {staff && (
              <details className="border-t mt-5 pt-3 text-sm">
                <summary className="cursor-pointer text-slate-500">
                  Order and shipment context
                </summary>
                <form
                  className="space-y-2 mt-3"
                  onSubmit={submit(
                    () =>
                      void run(async () => {
                        const { data } = await api.get<
                          NonNullable<typeof orderInfo>
                        >(`${base}/tickets/${selected}/order-context`, {
                          params: {
                            ...(orderId ? { order: orderId } : {}),
                            ...(awb ? { awb } : {}),
                          },
                        });
                        setOrderInfo(data);
                      }),
                  )}
                >
                  <input
                    className={control}
                    placeholder="Shopify order number"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                  />
                  <input
                    className={control}
                    placeholder="Shiprocket AWB"
                    value={awb}
                    onChange={(e) => setAwb(e.target.value)}
                  />
                  <button
                    className={secondary}
                    disabled={busy || (!orderId && !awb)}
                  >
                    Load order context
                  </button>
                </form>
                {orderInfo && (
                  <div className="my-3 text-sm">
                    {orderInfo.orders.map((order) => (
                      <p key={order.name}>
                        {order.name}: {order.fulfillmentStatus} ·{" "}
                        {order.paymentStatus}
                      </p>
                    ))}
                    {orderInfo.tracking && (
                      <p>
                        Shipment: {orderInfo.tracking.status} · Expected:{" "}
                        {orderInfo.tracking.estimatedDelivery || "not provided"}
                      </p>
                    )}
                    {!orderInfo.orders.length && !orderInfo.tracking && (
                      <p className="text-slate-400">
                        No connected order matches this customer. Check the
                        order number and channel connection.
                      </p>
                    )}
                  </div>
                )}
              </details>
            )}
            {staff && (
              <details className="border-t mt-5 pt-3 text-sm">
                <summary className="cursor-pointer text-slate-500">
                  Merge duplicate ticket
                </summary>
                <p className="my-2 text-slate-500">
                  Only tickets from the same customer can be merged. The
                  conversation moves to the destination.
                </p>
                <select
                  className={control}
                  value={mergeTarget}
                  onChange={(event) => setMergeTarget(event.target.value)}
                >
                  <option value="">Choose destination</option>
                  {tickets
                    .filter((item) => item._id !== selected)
                    .map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.number} — {item.subject}
                      </option>
                    ))}
                </select>
                <button
                  className={secondary + " mt-2"}
                  disabled={!mergeTarget || busy}
                  onClick={() =>
                    void run(async () => {
                      await api.post(`${base}/tickets/${selected}/merge`, {
                        target: mergeTarget,
                      });
                      setSelected(mergeTarget);
                      setMergeTarget("");
                      await load();
                    }, "Tickets merged.")
                  }
                >
                  Merge conversation
                </button>
              </details>
            )}
          </>
        ) : (
          <div className="text-center py-28 text-slate-400">
            <Inbox size={45} className="mx-auto mb-4" />
            <h2 className="font-medium text-slate-700">
              Your conversations live here
            </h2>
            <p className="text-sm mt-2">
              Select a ticket or create a new support request.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
function CannedSelect({
  base,
  select,
}: {
  base: string;
  select: (text: string) => void;
}) {
  const [items, setItems] = useState<Resource[]>([]);
  useEffect(() => {
    api
      .get<Resource[]>(base + "/resources/canned")
      .then(({ data }) => setItems(data))
      .catch(() => {});
  }, [base]);
  return (
    <select
      className={control + " max-w-[180px]"}
      aria-label="Canned reply"
      value=""
      onChange={(event) =>
        select(
          items.find((item) => item._id === event.target.value)?.value.text ||
            "",
        )
      }
    >
      <option value="">Insert saved reply…</option>
      {items.map((item) => (
        <option key={item._id} value={item._id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}
function CustomFields({
  fields,
  values,
  onChange,
}: {
  fields: Field[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  return (
    <>
      {fields.map((field) => (
        <label key={field.key} className="block text-sm">
          {field.label}
          {field.required ? " *" : ""}
          {field.type === "dropdown" ? (
            <select
              className={control}
              required={field.required}
              value={String(values[field.key] || "")}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.value })
              }
            >
              <option value="">Choose…</option>
              {field.options?.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : field.type === "checkbox" ? (
            <input
              className="ml-2"
              type="checkbox"
              checked={values[field.key] === true}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.checked })
              }
            />
          ) : (
            <input
              className={control}
              required={field.required}
              type={field.type === "number" ? "number" : "text"}
              value={String(values[field.key] ?? "")}
              onChange={(event) =>
                onChange({
                  ...values,
                  [field.key]:
                    field.type === "number"
                      ? Number(event.target.value)
                      : event.target.value,
                })
              }
            />
          )}
        </label>
      ))}
    </>
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
function KnowledgeView({
  workspace,
  manage,
  run,
  busy,
}: {
  workspace: Workspace;
  manage: boolean;
  run: Run;
  busy: boolean;
}) {
  const base = `/workspaces/${workspace._id}/articles`;
  const [items, setItems] = useState<Article[]>([]),
    [editing, setEditing] = useState(""),
    [title, setTitle] = useState(""),
    [slug, setSlug] = useState(""),
    [body, setBody] = useState(""),
    [category, setCategory] = useState("General"),
    [language, setLanguage] = useState("en"),
    [published, setPublished] = useState(false);
  const load = useCallback(async () => {
    const { data } = await api.get<Article[]>(base);
    setItems(data);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="grid md:grid-cols-[300px_1fr] gap-5">
      <section className="bg-white border rounded-xl p-4">
        <h2 className="font-semibold mb-4">Company knowledge</h2>
        <button
          className={secondary + " mb-4"}
          onClick={() => {
            setEditing("");
            setTitle("");
            setSlug("");
            setBody("");
            setPublished(false);
          }}
        >
          New article
        </button>
        {items.map((item) => (
          <button
            key={item._id}
            className="block text-left border-t w-full py-3"
            onClick={() => {
              setEditing(item._id);
              setTitle(item.title);
              setSlug(item.slug);
              setBody(item.body);
              setCategory(item.category);
              setLanguage(item.language);
              setPublished(item.published);
            }}
          >
            <span className="block text-sm font-medium">{item.title}</span>
            <span className="text-xs text-slate-400">
              {item.category} · {item.published ? "Published" : "Draft"}
            </span>
          </button>
        ))}
      </section>
      <form
        className="bg-white border rounded-xl p-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const input = { title, slug, body, category, language, published };
            if (editing) await api.patch(base + "/" + editing, input);
            else await api.post(base, input);
            await load();
          }, "Article saved.");
        }}
      >
        <h2 className="text-xl font-semibold">
          {editing ? "Edit article" : "Write a help article"}
        </h2>
        <p className="text-sm text-slate-500">
          Published articles appear in your help centre and support AI reply
          suggestions. Drafts remain private to your staff.
        </p>
        <label className="block text-sm">
          Title
          <input
            className={control}
            required
            minLength={3}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (!editing)
                setSlug(
                  event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, ""),
                );
            }}
          />
        </label>
        <label className="block text-sm">
          Article address
          <input
            className={control}
            required
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Category
            <input
              className={control}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Language
            <select
              className={control}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {["en", "hi", "bn", "ta", "te", "mr", "hinglish"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          Article content
          <textarea
            required
            minLength={10}
            rows={12}
            className={control}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <input
            type="checkbox"
            disabled={!manage}
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
          />{" "}
          Publish to the customer help centre
        </label>
        <button className={button} disabled={busy}>
          Save article
        </button>
      </form>
    </div>
  );
}
function ContactsView({ workspace, run }: { workspace: Workspace; run: Run }) {
  const [items, setItems] = useState<Contact[]>([]),
    [selected, setSelected] = useState<Contact | null>(null);
  const load = useCallback(async () => {
    const { data } = await api.get<Contact[]>(
      `/workspaces/${workspace._id}/contacts`,
    );
    setItems(data);
  }, [workspace._id]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="grid md:grid-cols-2 gap-5">
      <section className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold mb-4">Customer directory</h2>
        {items.length === 0 && (
          <p className="text-sm text-slate-500">
            Customers appear when they submit their first ticket.
          </p>
        )}
        {items.map((item) => (
          <button
            key={item._id}
            className="block text-left w-full border-t py-3"
            onClick={() => setSelected({ ...item })}
          >
            <p className="text-sm font-medium">{item.name || item.email}</p>
            <p className="text-xs text-slate-500">
              {item.email}
              {item.company ? " · " + item.company : ""}
            </p>
          </button>
        ))}
      </section>
      {selected && (
        <form
          className="bg-white border rounded-xl p-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api.patch(
                `/workspaces/${workspace._id}/contacts/${selected._id}`,
                {
                  name: selected.name,
                  company: selected.company || "",
                  phone: selected.phone || "",
                  notes: selected.notes || "",
                },
              );
              await load();
            }, "Customer profile saved.");
          }}
        >
          <h2 className="font-semibold">Customer context</h2>
          <p className="text-sm text-slate-500">{selected.email}</p>
          {(["name", "phone", "company"] as const).map((key) => (
            <label className="block text-sm capitalize" key={key}>
              {key}
              <input
                className={control}
                value={selected[key] || ""}
                onChange={(event) =>
                  setSelected({ ...selected, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <label className="block text-sm">
            Private customer notes
            <textarea
              rows={5}
              className={control}
              value={selected.notes || ""}
              onChange={(event) =>
                setSelected({ ...selected, notes: event.target.value })
              }
            />
          </label>
          <button className={button}>Save profile</button>
        </form>
      )}
    </div>
  );
}
function ToolsView({
  workspace,
  manage,
  run,
  busy,
}: {
  workspace: Workspace;
  manage: boolean;
  run: Run;
  busy: boolean;
}) {
  const [kind, setKind] = useState("canned"),
    [items, setItems] = useState<Resource[]>([]),
    [name, setName] = useState(""),
    [text, setText] = useState(""),
    [priority, setPriority] = useState(""),
    [status, setStatus] = useState(""),
    [event, setEvent] = useState("ticket.created"),
    [matchPriority, setMatchPriority] = useState("");
  const base = `/workspaces/${workspace._id}/resources/${kind}`;
  const load = useCallback(async () => {
    const { data } = await api.get<Resource[]>(base);
    setItems(data);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="grid md:grid-cols-2 gap-5">
      <section className="bg-white border rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-3">Agent productivity</h2>
        <div className="flex flex-wrap gap-2 mb-5">
          {["canned", "macro", "view", ...(manage ? ["automation"] : [])].map(
            (value) => (
              <button
                key={value}
                className={kind === value ? button : secondary}
                onClick={() => setKind(value)}
              >
                {
                  (
                    {
                      canned: "Saved replies",
                      macro: "Macros",
                      view: "Saved views",
                      automation: "Automation",
                    } as Record<string, string>
                  )[value]
                }
              </button>
            ),
          )}
        </div>
        {items.map((item) => (
          <div
            key={item._id}
            className="border-t py-3 flex justify-between gap-3"
          >
            <div>
              <h3 className="font-medium text-sm">{item.name}</h3>
              <p className="text-xs text-slate-400 whitespace-pre-wrap mt-1">
                {item.value.text ||
                  item.value.event ||
                  item.value.status ||
                  item.value.actions?.status ||
                  "Custom shortcut"}
              </p>
            </div>
            <button
              className="text-xs text-red-600"
              onClick={() =>
                void run(async () => {
                  await api.delete(
                    `/workspaces/${workspace._id}/resources/${item._id}`,
                  );
                  await load();
                }, "Removed.")
              }
            >
              Remove
            </button>
          </div>
        ))}
      </section>
      <form
        className="bg-white border rounded-xl p-5 space-y-4"
        onSubmit={submit(() => {
          const action = {
            ...(priority ? { priority } : {}),
            ...(status ? { status } : {}),
            ...(text ? { reply: text } : {}),
          };
          const value =
            kind === "canned"
              ? { text }
              : kind === "view"
                ? {
                    ...(priority ? { priority } : {}),
                    ...(status ? { status } : {}),
                  }
                : kind === "macro"
                  ? { actions: action }
                  : {
                      event,
                      conditions: matchPriority
                        ? [
                            {
                              field: "priority",
                              operator: "eq",
                              value: matchPriority,
                            },
                          ]
                        : [],
                      actions: action,
                    };
          void run(async () => {
            await api.post(base, { name, value });
            setName("");
            setText("");
            await load();
          }, "Saved.");
        })}
      >
        <h2 className="font-semibold">
          Create{" "}
          {kind === "canned"
            ? "a saved reply"
            : kind === "view"
              ? "a saved inbox view"
              : kind === "macro"
                ? "a reusable macro"
                : "an automation rule"}
        </h2>
        <label className="block text-sm">
          Name
          <input
            required
            minLength={2}
            className={control}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {kind === "automation" && (
          <>
            <label className="block text-sm">
              When
              <select
                className={control}
                value={event}
                onChange={(event) => setEvent(event.target.value)}
              >
                {[
                  "ticket.created",
                  "ticket.updated",
                  "customer.replied",
                  "sla.breached",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              If priority is
              <select
                className={control}
                value={matchPriority}
                onChange={(event) => setMatchPriority(event.target.value)}
              >
                <option value="">Any priority</option>
                {["Low", "Medium", "High", "Critical"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {kind !== "canned" && (
          <>
            <label className="block text-sm">
              {kind === "view" ? "Filter by priority" : "Set priority"}
              <select
                className={control}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="">No priority change/filter</option>
                {["Low", "Medium", "High", "Critical"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {kind === "view" ? "Filter by status" : "Set status"}
              <select
                className={control}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">No status change/filter</option>
                {workspace.settings.statuses.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {kind !== "view" && (
          <label className="block text-sm">
            {kind === "canned" ? "Saved response" : "Optional public reply"}
            <textarea
              rows={5}
              className={control}
              required={kind === "canned"}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}
        <button disabled={busy} className={button}>
          Save {kind}
        </button>
        <p className="text-xs text-slate-400">
          Macros apply only when an agent selects them. Automation rules run
          when their trigger and conditions match.
        </p>
      </form>
    </div>
  );
}
function submit(action: (event: FormEvent<HTMLFormElement>) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    action(event);
  };
}
function TeamView({
  workspace,
  role,
  run,
  busy,
}: {
  workspace: Workspace;
  role: string;
  run: Run;
  busy: boolean;
}) {
  const base = `/workspaces/${workspace._id}`;
  const [members, setMembers] = useState<Member[]>([]),
    [email, setEmail] = useState(""),
    [inviteRole, setInviteRole] = useState("agent"),
    [url, setUrl] = useState("");
  const load = useCallback(async () => {
    const { data } = await api.get<Member[]>(base + "/members");
    setMembers(data);
  }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="space-y-5">
      <section className="bg-white border rounded-xl p-5">
        <h2 className="text-lg font-semibold">Invite your support team</h2>
        <p className="text-sm text-slate-500 my-2">
          Invitations are tied to an email address, expire after seven days and
          can be accepted once. Customers do not use staff seats.
        </p>
        <form
          className="flex flex-wrap gap-3 mt-4"
          onSubmit={submit(
            () =>
              void run(async () => {
                const { data } = await api.post<{ url: string }>(
                  base + "/invites",
                  { email, role: inviteRole },
                );
                setUrl(data.url);
                setEmail("");
              }, "Invitation created. Copy the link and share it with the invited person."),
          )}
        >
          <input
            required
            type="email"
            className={control + " max-w-sm"}
            placeholder="teammate@company.in"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <select
            className={control + " max-w-[180px]"}
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value)}
          >
            {[
              ...(role === "owner" ? ["admin"] : []),
              "agent",
              "analyst",
              "customer",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <button disabled={busy} className={button}>
            Create invitation
          </button>
        </form>
        {url && (
          <div className="mt-4 flex gap-2">
            <input
              readOnly
              className={control}
              aria-label="Invitation link"
              value={url}
            />
            <button
              className={secondary}
              onClick={() => void navigator.clipboard.writeText(url)}
            >
              Copy
            </button>
          </div>
        )}
      </section>
      <section className="bg-white border rounded-xl overflow-hidden">
        <div className="p-5 border-b">
          <h2 className="font-semibold">Members and routing capacity</h2>
        </div>
        {members.map((item) => (
          <div
            key={item._id}
            className="p-4 border-b flex flex-wrap items-center gap-4"
          >
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-medium">{item.name || item.email}</p>
              <p className="text-xs text-slate-500">{item.email}</p>
            </div>
            <select
              aria-label={`Role for ${item.email}`}
              disabled={busy || (item.role === "owner" && role !== "owner")}
              className={control + " max-w-[140px]"}
              value={item.role}
              onChange={(event) =>
                void run(async () => {
                  await api.patch(base + "/members/" + item._id, {
                    role: event.target.value,
                  });
                  await load();
                })
              }
            >
              {["owner", "admin", "agent", "analyst", "customer"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
            <label className="text-xs text-slate-500">
              Active tickets
              <input
                aria-label={`Capacity for ${item.email}`}
                type="number"
                min={1}
                max={100}
                className={control + " w-20"}
                defaultValue={item.capacity}
                onBlur={(event) => {
                  if (Number(event.target.value) !== item.capacity)
                    void run(async () => {
                      await api.patch(base + "/members/" + item._id, {
                        capacity: Number(event.target.value),
                      });
                      await load();
                    });
                }}
              />
            </label>
            <button
              className={secondary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.patch(base + "/members/" + item._id, {
                    online: !item.online,
                  });
                  await load();
                })
              }
            >
              {item.online ? "Available" : "Offline"}
            </button>
            <button
              className={item.active ? secondary : button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.patch(base + "/members/" + item._id, {
                    active: !item.active,
                  });
                  await load();
                })
              }
            >
              {item.active ? "Deactivate" : "Activate"}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
function SettingsView({
  workspace,
  run,
  busy,
  refresh,
}: {
  workspace: Workspace;
  run: Run;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const [settings, setSettings] = useState(workspace.settings),
    [label, setLabel] = useState(""),
    [fieldType, setFieldType] = useState<Field["type"]>("text"),
    [options, setOptions] = useState("");
  return (
    <div className="grid md:grid-cols-2 gap-5">
      <form
        className="bg-white border rounded-xl p-6 space-y-4"
        onSubmit={submit(
          () =>
            void run(async () => {
              await api.patch(`/workspaces/${workspace._id}`, { settings });
              await refresh();
            }, "Settings saved."),
        )}
      >
        <h2 className="text-xl font-semibold">Service hours and SLAs</h2>
        <label className="block text-sm">
          Timezone
          <input
            className={control}
            value={settings.timezone}
            onChange={(e) =>
              setSettings({ ...settings, timezone: e.target.value })
            }
          />
        </label>
        <div className="flex flex-wrap gap-3">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
            (day, index) => (
              <label key={day} className="text-xs">
                <input
                  type="checkbox"
                  checked={settings.businessHours.days.includes(index)}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      businessHours: {
                        ...settings.businessHours,
                        days: e.target.checked
                          ? [...settings.businessHours.days, index]
                          : settings.businessHours.days.filter(
                              (value) => value !== index,
                            ),
                      },
                    })
                  }
                />{" "}
                {day}
              </label>
            ),
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(["start", "end"] as const).map((key) => (
            <label key={key} className="text-sm">
              {key === "start" ? "Opening" : "Closing"} time
              <input
                type="time"
                className={control}
                value={settings.businessHours[key]}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    businessHours: {
                      ...settings.businessHours,
                      [key]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          Holidays (YYYY-MM-DD, comma separated)
          <input
            className={control}
            value={settings.businessHours.holidays.join(",")}
            onChange={(e) =>
              setSettings({
                ...settings,
                businessHours: {
                  ...settings.businessHours,
                  holidays: e.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
        <label className="block text-sm">
          <input
            type="checkbox"
            checked={settings.sla.businessHours}
            onChange={(e) =>
              setSettings({
                ...settings,
                sla: { ...settings.sla, businessHours: e.target.checked },
              })
            }
          />{" "}
          Count only business hours
        </label>
        {(
          [
            ["firstResponse", "First response"],
            ["nextResponse", "Next response"],
            ["resolution", "Resolution"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block text-sm">
            {label} target, minutes
            <input
              type="number"
              required
              min={1}
              max={43200}
              className={control}
              value={settings.sla[key]}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  sla: { ...settings.sla, [key]: Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
        <label className="block text-sm">
          Ticket statuses
          <input
            className={control}
            value={settings.statuses.join(",")}
            onChange={(e) =>
              setSettings({
                ...settings,
                statuses: e.target.value
                  .split(",")
                  .map((value) => value.trim()),
              })
            }
          />
        </label>
        <label className="block text-sm">
          Pause SLA in these statuses
          <input
            className={control}
            value={settings.pauseStatuses.join(",")}
            onChange={(e) =>
              setSettings({
                ...settings,
                pauseStatuses: e.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="block text-sm">
          <input
            type="checkbox"
            checked={settings.publicPortal}
            onChange={(e) =>
              setSettings({ ...settings, publicPortal: e.target.checked })
            }
          />{" "}
          Public help centre enabled
        </label>
        <button disabled={busy} className={button}>
          Save settings
        </button>
      </form>
      <section className="bg-white border rounded-xl p-6">
        <h2 className="font-semibold">Custom ticket fields</h2>
        {settings.customFields.map((field) => (
          <div
            key={field.key}
            className="border-b py-3 flex justify-between text-sm"
          >
            <span>
              {field.label} · {field.type}
            </span>
            <button
              className="text-red-600"
              onClick={() =>
                setSettings({
                  ...settings,
                  customFields: settings.customFields.filter(
                    (item) => item.key !== field.key,
                  ),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <form
          className="space-y-3 my-5"
          onSubmit={submit(() => {
            setSettings({
              ...settings,
              customFields: [
                ...settings.customFields,
                {
                  key: label
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
                    .slice(0, 40),
                  label,
                  type: fieldType,
                  required: false,
                  ...(fieldType === "dropdown"
                    ? {
                        options: options
                          .split(",")
                          .map((value) => value.trim()),
                      }
                    : {}),
                },
              ],
            });
            setLabel("");
            setOptions("");
          })}
        >
          <label className="block text-sm">
            Field label
            <input
              required
              className={control}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <select
            aria-label="Field type"
            className={control}
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as Field["type"])}
          >
            {["text", "number", "dropdown", "checkbox"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          {fieldType === "dropdown" && (
            <input
              className={control}
              required
              placeholder="Options, separated by commas"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          )}
          <button className={secondary}>Add field</button>
          <p className="text-xs text-slate-400">
            Publish changes with Save settings.
          </p>
        </form>
        <SLAPolicies workspace={workspace} run={run} busy={busy} />
        <h3 className="text-sm font-semibold mt-8">Website support widget</h3>
        <p className="text-xs text-slate-500 my-2">
          Place this script on your website.
        </p>
        <pre className="whitespace-pre-wrap break-all bg-slate-50 rounded p-3 text-xs">{`<script src="${String(api.defaults.baseURL).replace(/\/$/, "")}/help/${workspace.slug}/widget.js" defer></script>`}</pre>
      </section>
    </div>
  );
}
function ConnectionsView({
  workspace,
  run,
  busy,
}: {
  workspace: Workspace;
  run: Run;
  busy: boolean;
}) {
  const [items, setItems] = useState<
      { _id: string; name: string; kind: string; enabled: boolean }[]
    >([]),
    [kind, setKind] = useState("email"),
    [name, setName] = useState(""),
    [token, setToken] = useState(""),
    [secret, setSecret] = useState(""),
    [phone, setPhone] = useState(""),
    [slack, setSlack] = useState(""),
    [address, setAddress] = useState(""),
    [shop, setShop] = useState(""),
    [webhook, setWebhook] = useState(""),
    [result, setResult] = useState<Record<string, string> | null>(null);
  const base = `/workspaces/${workspace._id}/connectors`,
    load = useCallback(async () => {
      const { data } = await api.get<typeof items>(base);
      setItems(data);
    }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="grid md:grid-cols-2 gap-5">
      <section className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold">Connected channels</h2>
        {items.map((item) => (
          <div key={item._id} className="border-t py-4 flex justify-between">
            <div>
              <p className="font-medium text-sm">{item.name}</p>
              <p className="text-xs text-slate-400">{item.kind}</p>
            </div>
            <button
              disabled={busy}
              className={secondary}
              onClick={() =>
                void run(async () => {
                  await api.patch(base + "/" + item._id, {
                    enabled: !item.enabled,
                  });
                  await load();
                })
              }
            >
              {item.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        ))}
        <p className="text-xs text-slate-500 mt-4">
          The helpdesk worker delivers queued replies, retries failures and
          checks SLAs. Incoming email requires a signed provider gateway;
          WhatsApp uses Meta webhooks.
        </p>
        <ApiKeysView workspace={workspace} run={run} busy={busy} />
        <DeliveryJobs workspace={workspace} run={run} />
      </section>
      <form
        className="bg-white border rounded-xl p-5 space-y-4"
        onSubmit={submit(
          () =>
            void run(async () => {
              const { data } = await api.post<Record<string, string>>(base, {
                kind,
                name,
                ...(kind === "whatsapp"
                  ? { token, appSecret: secret, phoneNumberId: phone }
                  : {}),
                ...(kind === "slack" ? { slackUrl: slack } : {}),
                ...(kind === "webhook" ? { webhookUrl: webhook } : {}),
                ...(kind === "email" && address
                  ? { fromAddress: address }
                  : {}),
                ...(["shopify", "shiprocket"].includes(kind)
                  ? {
                      token,
                      ...(kind === "shopify" ? { shopDomain: shop } : {}),
                    }
                  : {}),
              });
              setResult(data);
              setToken("");
              setSecret("");
              setSlack("");
              await load();
            }, "Connection created. Complete provider setup using the details below."),
        )}
      >
        <h2 className="font-semibold">Connect a channel</h2>
        <label className="block text-sm">
          Channel
          <select
            className={control}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setResult(null);
            }}
          >
            {[
              "email",
              "whatsapp",
              "slack",
              "shopify",
              "shiprocket",
              "webhook",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Connection name
          <input
            required
            minLength={2}
            className={control}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {kind === "email" && (
          <label className="block text-sm">
            Reply-to email
            <input
              type="email"
              className={control}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        )}
        {kind === "whatsapp" && (
          <>
            {[
              ["Phone number ID", phone, setPhone],
              ["Access token", token, setToken],
              ["Meta app secret", secret, setSecret],
            ].map(([label, value, setter]) => (
              <label key={String(label)} className="block text-sm">
                {String(label)}
                <input
                  required
                  type={label === "Phone number ID" ? "text" : "password"}
                  autoComplete="off"
                  className={control}
                  value={String(value)}
                  onChange={(e) =>
                    (setter as (value: string) => void)(e.target.value)
                  }
                />
              </label>
            ))}
            <p className="text-xs text-slate-500">
              Text replies must follow Meta’s customer-service window and
              template requirements.
            </p>
          </>
        )}
        {kind === "shopify" && (
          <label className="block text-sm">
            Shopify store domain
            <input
              required
              placeholder="your-store.myshopify.com"
              className={control}
              value={shop}
              onChange={(e) => setShop(e.target.value)}
            />
          </label>
        )}
        {["shopify", "shiprocket"].includes(kind) && (
          <label className="block text-sm">
            {kind === "shopify"
              ? "Admin API access token"
              : "Shiprocket bearer token"}
            <input
              required
              type="password"
              autoComplete="off"
              className={control}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
        )}
        {kind === "webhook" && (
          <label className="block text-sm">
            Public HTTPS event receiver
            <input
              required
              type="url"
              className={control}
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
            />
          </label>
        )}
        {kind === "slack" && (
          <label className="block text-sm">
            Slack incoming webhook URL
            <input
              required
              type="password"
              autoComplete="off"
              className={control}
              value={slack}
              onChange={(e) => setSlack(e.target.value)}
            />
          </label>
        )}
        <button disabled={busy} className={button}>
          Create connection
        </button>
        {result && (
          <div className="bg-amber-50 rounded-xl p-4">
            <h3 className="text-sm font-medium">Save these details securely</h3>
            {Object.entries(result).map(([key, value]) => (
              <label className="block text-xs mt-3" key={key}>
                {key}
                <input
                  readOnly
                  className={control}
                  value={
                    key === "webhookPath"
                      ? String(api.defaults.baseURL).replace(/\/api\/?$/, "") +
                        value
                      : String(value)
                  }
                />
              </label>
            ))}
            <p className="text-xs mt-3">
              Secrets are shown once. Add them to your provider or gateway
              configuration.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
function BillingView({
  workspace,
  owner,
  run,
  busy,
  refresh,
}: {
  workspace: Workspace;
  owner: boolean;
  run: Run;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const [billing, setBilling] = useState<{
      billing: Workspace["billing"];
      usedSeats: number;
      configured: boolean;
    } | null>(null),
    [seats, setSeats] = useState(2),
    [plan, setPlan] = useState("Pro");
  const base = `/workspaces/${workspace._id}/billing`,
    load = useCallback(async () => {
      const { data } = await api.get<NonNullable<typeof billing>>(base);
      setBilling(data);
      setSeats(Math.max(data.usedSeats, data.billing.seats));
    }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  const sessionId = new URLSearchParams(location.search).get("checkout");
  return (
    <section className="bg-white border rounded-xl p-6 max-w-2xl">
      <h2 className="text-xl font-semibold">Workspace billing</h2>
      <p className="text-sm text-slate-500 my-3">
        The business pays for staff seats. Customers can submit support requests
        for free.
      </p>
      <div className="grid grid-cols-3 gap-3 my-5">
        {[
          ["Plan", billing?.billing.plan || "Free"],
          ["Staff", String(billing?.usedSeats || 0)],
          ["Seats", String(billing?.billing.seats || 2)],
        ].map(([label, value]) => (
          <div className="bg-slate-50 p-4 rounded-xl" key={label}>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="text-2xl font-semibold mt-2">{value}</p>
          </div>
        ))}
      </div>
      {!billing?.configured && (
        <p className="bg-amber-50 rounded p-3 text-sm text-amber-800">
          The platform operator must configure recurring Stripe prices before
          paid checkout is available.
        </p>
      )}
      {sessionId && owner && (
        <button
          className={button + " my-3"}
          onClick={() =>
            void run(async () => {
              await api.post(base + "/verify", { sessionId });
              await load();
              await refresh();
              history.replaceState(null, "", "/workspaces");
            }, "Subscription verified.")
          }
        >
          Verify completed checkout
        </button>
      )}
      {owner && (
        <form
          className="space-y-4 mt-5"
          onSubmit={submit(
            () =>
              void run(async () => {
                const { data } = await api.post<{ url: string }>(
                  base + "/checkout",
                  { plan, seats },
                );
                location.assign(data.url);
              }),
          )}
        >
          <select
            aria-label="Subscription plan"
            className={control}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            <option>Pro</option>
            <option>Premium</option>
          </select>
          <label className="block text-sm">
            Staff seats
            <input
              type="number"
              min={billing?.usedSeats || 1}
              max={1000}
              className={control}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
            />
          </label>
          <div className="flex gap-3">
            <button disabled={busy || !billing?.configured} className={button}>
              Continue to checkout
            </button>
            <button
              type="button"
              disabled={busy || !billing?.billing.expiresAt}
              className={secondary}
              onClick={() =>
                void run(async () => {
                  const { data } = await api.post<{ url: string }>(
                    base + "/portal",
                  );
                  location.assign(data.url);
                })
              }
            >
              Manage subscription
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function ReportsView({ workspace, run }: { workspace: Workspace; run: Run }) {
  const [report, setReport] = useState<{
    total: number;
    breached: number;
    contacts: number;
    byStatus: { _id: string; count: number }[];
  } | null>(null);
  const base = `/workspaces/${workspace._id}/reports`;
  useEffect(() => {
    void run(async () => {
      const { data } = await api.get<NonNullable<typeof report>>(base);
      setReport(data);
    });
  }, [base, run]);
  return (
    <section className="bg-white border rounded-xl p-6">
      <div className="flex justify-between">
        <h2 className="text-xl font-semibold">Support performance</h2>
        <button
          className={secondary}
          onClick={() =>
            void run(async () => {
              const { data } = await api.get<Blob>(base + "?format=csv", {
                responseType: "blob",
              });
              download(data, "support-report.csv");
            })
          }
        >
          Export CSV
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4 my-6">
        {[
          ["Tickets", report?.total || 0],
          ["SLA breaches", report?.breached || 0],
          ["Customers", report?.contacts || 0],
        ].map(([label, value]) => (
          <div key={label} className="bg-slate-50 rounded-xl p-5">
            <p className="text-sm text-slate-400">{label}</p>
            <p className="text-3xl font-semibold mt-2">{value}</p>
          </div>
        ))}
      </div>
      {report?.byStatus.map((item) => (
        <div
          key={item._id}
          className="border-t py-3 flex justify-between text-sm"
        >
          <span>{item._id}</span>
          <strong>{item.count}</strong>
        </div>
      ))}
    </section>
  );
}
function SLAPolicies({
  workspace,
  run,
  busy,
}: {
  workspace: Workspace;
  run: Run;
  busy: boolean;
}) {
  const [name, setName] = useState(""),
    [priority, setPriority] = useState("High"),
    [first, setFirst] = useState(60),
    [next, setNext] = useState(60),
    [resolution, setResolution] = useState(480),
    [policies, setPolicies] = useState<{ _id: string; name: string }[]>([]);
  const base = `/workspaces/${workspace._id}/resources/sla`,
    load = useCallback(async () => {
      const { data } = await api.get<typeof policies>(base);
      setPolicies(data);
    }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="border-t mt-6 pt-5">
      <h3 className="font-semibold">Priority SLA policies</h3>
      <p className="text-xs text-slate-500 my-2">
        The first matching policy applies to newly created tickets. Existing
        deadlines keep their original policy.
      </p>
      {policies.map((item) => (
        <div key={item._id} className="text-sm py-2 flex justify-between">
          <span>{item.name}</span>
          <button
            className="text-red-600"
            onClick={() =>
              void run(async () => {
                await api.delete(
                  `/workspaces/${workspace._id}/resources/${item._id}`,
                );
                await load();
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <form
        className="space-y-2 mt-3"
        onSubmit={submit(
          () =>
            void run(async () => {
              await api.post(base, {
                name,
                value: {
                  conditions: [
                    { field: "priority", operator: "eq", value: priority },
                  ],
                  policy: {
                    firstResponse: first,
                    nextResponse: next,
                    resolution,
                    businessHours: workspace.settings.sla.businessHours,
                  },
                },
              });
              setName("");
              await load();
            }, "SLA policy created."),
        )}
      >
        <input
          required
          className={control}
          placeholder="Policy name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label="Policy priority"
          className={control}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          {["Low", "Medium", "High", "Critical"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        {[
          ["First response", first, setFirst],
          ["Next response", next, setNext],
          ["Resolution", resolution, setResolution],
        ].map(([label, value, setter]) => (
          <label className="block text-xs" key={String(label)}>
            {String(label)} minutes
            <input
              required
              min={1}
              max={43200}
              type="number"
              className={control}
              value={Number(value)}
              onChange={(e) =>
                (setter as (n: number) => void)(Number(e.target.value))
              }
            />
          </label>
        ))}
        <button disabled={busy} className={secondary}>
          Add SLA policy
        </button>
      </form>
    </div>
  );
}
function ApiKeysView({
  workspace,
  run,
  busy,
}: {
  workspace: Workspace;
  run: Run;
  busy: boolean;
}) {
  const [keys, setKeys] = useState<
      {
        _id: string;
        name: string;
        prefix: string;
        expiresAt: string;
        revokedAt?: string;
      }[]
    >([]),
    [name, setName] = useState(""),
    [scopes, setScopes] = useState(["tickets:read"]),
    [token, setToken] = useState("");
  const base = `/workspaces/${workspace._id}/api-keys`,
    load = useCallback(async () => {
      const { data } = await api.get<typeof keys>(base);
      setKeys(data);
    }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="mt-8 border-t pt-5">
      <h3 className="font-semibold text-sm">Developer API keys</h3>
      <p className="text-xs text-slate-500 mt-2">
        Keys expire after 90 days and stop working when their creator loses
        staff access. Save new keys securely; they are shown once.
      </p>
      {keys.map((item) => (
        <div
          className="flex justify-between text-xs py-3 border-b"
          key={item._id}
        >
          <div>
            {item.name}
            <p className="text-slate-400">
              {item.prefix}… ·{" "}
              {item.revokedAt
                ? "Revoked"
                : new Date(item.expiresAt).toLocaleDateString()}
            </p>
          </div>
          {!item.revokedAt && (
            <button
              className="text-red-600"
              onClick={() =>
                void run(async () => {
                  await api.delete(base + "/" + item._id);
                  await load();
                }, "API key revoked.")
              }
            >
              Revoke
            </button>
          )}
        </div>
      ))}
      <form
        className="space-y-3 mt-4"
        onSubmit={submit(
          () =>
            void run(async () => {
              const { data } = await api.post<{ token: string }>(base, {
                name,
                scopes,
              });
              setToken(data.token);
              setName("");
              await load();
            }, "API key created. Save it now."),
        )}
      >
        <input
          required
          minLength={2}
          className={control}
          placeholder="Integration name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          {[
            "tickets:read",
            "tickets:write",
            "contacts:read",
            "articles:read",
          ].map((scope) => (
            <label key={scope} className="text-xs">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked
                      ? [...scopes, scope]
                      : scopes.filter((value) => value !== scope),
                  )
                }
              />{" "}
              {scope}
            </label>
          ))}
        </div>
        <button disabled={busy || !scopes.length} className={secondary}>
          Generate API key
        </button>
        {token && (
          <input
            className={control}
            aria-label="New API key"
            readOnly
            value={token}
          />
        )}
      </form>
    </div>
  );
}
function DeliveryJobs({ workspace, run }: { workspace: Workspace; run: Run }) {
  const [jobs, setJobs] = useState<
    {
      _id: string;
      kind: string;
      state: string;
      attempts: number;
      lastError?: string;
    }[]
  >([]);
  const base = `/workspaces/${workspace._id}/jobs`,
    load = useCallback(async () => {
      const { data } = await api.get<typeof jobs>(base);
      setJobs(data);
    }, [base]);
  useEffect(() => {
    void run(load);
  }, [load, run]);
  return (
    <div className="mt-8 border-t pt-5">
      <div className="flex justify-between">
        <h3 className="text-sm font-semibold">Delivery activity</h3>
        <button
          className="text-xs text-blue-600"
          onClick={() => void run(load)}
        >
          Refresh
        </button>
      </div>
      {jobs.slice(0, 10).map((job) => (
        <div key={job._id} className="text-xs py-3 border-b">
          <div className="flex justify-between">
            <span>
              {job.kind} · {job.state} · Attempt {job.attempts}
            </span>
            {job.state === "failed" && (
              <button
                className="text-blue-600"
                onClick={() =>
                  void run(async () => {
                    await api.post(base + "/" + job._id + "/retry");
                    await load();
                  })
                }
              >
                Retry
              </button>
            )}
          </div>
          {job.lastError && (
            <p className="text-amber-700 mt-1">{job.lastError}</p>
          )}
        </div>
      ))}
      {!jobs.length && (
        <p className="text-xs text-slate-400 mt-3">
          No outgoing deliveries yet.
        </p>
      )}
    </div>
  );
}
