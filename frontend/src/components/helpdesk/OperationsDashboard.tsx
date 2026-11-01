import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Inbox,
  RefreshCw,
  Save,
  Users,
  AlertTriangle,
} from "lucide-react";
import api from "../../utils/api";
type Run = (action: () => Promise<void>, success?: string) => Promise<void>;
interface Agent {
  _id: string;
  name: string;
  email: string;
  online: boolean;
  capacity: number;
  open?: number;
  resolved?: number;
  responseMinutes?: number;
  entitlementSuspended?: boolean;
}
interface Data {
  summary: Record<string, number | null>;
  trend: { _id: string; created: number }[];
  channels: { _id: string; count: number }[];
  priorities: { _id: string; count: number }[];
  agents: Agent[];
  activity: {
    _id: string;
    action: string;
    target: string;
    createdAt: string;
  }[];
  range: { days: number; timezone: string };
  entitlement: { plan: string; features: string[] };
}
const widgets = [
  "summary",
  "trend",
  "channels",
  "priorities",
  "agents",
  "activity",
];
const label = (s: string) => s.replace(/[._-]/g, " ");
const mins = (n?: number | null) =>
  n == null ? "—" : n < 60 ? `${Math.round(n)}m` : `${(n / 60).toFixed(1)}h`;
export default function OperationsDashboard({
  workspaceId,
  name,
  role,
  run,
  onQueue,
}: {
  workspaceId: string;
  name: string;
  role: string;
  run: Run;
  onQueue: (bucket: string) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [days, setDays] = useState(30),
    [visible, setVisible] = useState(widgets),
    [dashboards, setDashboards] = useState<
      { _id: string; name: string; widgets: string[]; days: number }[]
    >([]),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState("My operations dashboard"),
    [updated, setUpdated] = useState("");
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      api.get<Data>(`/workspaces/${workspaceId}/operations`, {
        params: { days },
      }),
      api.get<typeof dashboards>(`/workspaces/${workspaceId}/dashboards`),
    ]);
    setData(a.data);
    setDashboards(b.data);
    setUpdated(new Date().toLocaleTimeString());
  }, [workspaceId, days]);
  useEffect(() => {
    void run(load);
    const timer = setInterval(() => {
      void load().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [load, run]);
  if (!data)
    return (
      <div
        className="rounded-2xl border bg-white p-12 text-slate-500"
        role="status"
      >
        Loading workspace metrics…
      </div>
    );
  const cards = [
    {
      key: "open",
      title: "Unresolved tickets",
      icon: Inbox,
      color: "text-sky-600",
      bucket: "open",
    },
    {
      key: "overdue",
      title: "Overdue",
      icon: AlertTriangle,
      color: "text-rose-600",
      bucket: "overdue",
    },
    {
      key: "dueToday",
      title: "Due in 24 hours",
      icon: Clock3,
      color: "text-amber-600",
      bucket: "due-today",
    },
    {
      key: "unassigned",
      title: "Unassigned",
      icon: Users,
      color: "text-violet-600",
      bucket: "unassigned",
    },
    {
      key: "resolved",
      title: "Resolved & closed",
      icon: CheckCircle2,
      color: "text-emerald-600",
      bucket: "resolved",
    },
  ];
  const max = Math.max(1, ...data.trend.map((r) => r.created)),
    points = data.trend
      .map(
        (r, i) =>
          `${data.trend.length === 1 ? 300 : 20 + (i * 560) / (data.trend.length - 1)},${160 - (r.created / max) * 130}`,
      )
      .join(" "),
    sum = data.channels.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[.18em] font-semibold text-teal-700">
            {role === "agent" ? "My performance" : "Workspace intelligence"}
          </p>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">
            Operations overview
          </h2>
          <p className="text-sm text-slate-500 mt-2">
            A clear view of {name}’s support workload.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Saved dashboard"
            className="border rounded-lg bg-white px-3 py-2 text-sm max-w-full"
            value=""
            onChange={(e) => {
              const d = dashboards.find((x) => x._id === e.target.value);
              if (d) {
                setVisible(d.widgets);
                setDays(d.days);
                setTitle(d.name);
              }
            }}
          >
            <option value="">Saved dashboards</option>
            {dashboards.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Dashboard date range"
            className="border rounded-lg bg-white px-3 py-2 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 30, 90].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </select>
          <button
            className="border rounded-lg bg-white px-3 py-2 text-sm"
            onClick={() => setEditing(!editing)}
          >
            Customize
          </button>
          <button
            aria-label="Refresh dashboard"
            className="border rounded-lg bg-white p-2"
            onClick={() => void run(load)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      {editing && (
        <section className="p-5 border border-teal-200 bg-teal-50 rounded-xl">
          <h3 className="font-semibold">Build your dashboard</h3>
          <div className="flex flex-wrap gap-4 my-4">
            {widgets.map((w) => (
              <label key={w} className="text-sm capitalize">
                <input
                  type="checkbox"
                  checked={visible.includes(w)}
                  onChange={(e) =>
                    setVisible((old) =>
                      e.target.checked
                        ? [...old, w]
                        : old.filter((x) => x !== w),
                    )
                  }
                />{" "}
                {w}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Dashboard name"
              className="border rounded-lg px-3 py-2 min-w-0"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              className="bg-teal-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
              onClick={() =>
                void run(async () => {
                  await api.post(`/workspaces/${workspaceId}/dashboards`, {
                    name: title,
                    widgets: visible,
                    days,
                  });
                  await load();
                  setEditing(false);
                }, "Dashboard saved.")
              }
            >
              <Save size={16} />
              Save dashboard
            </button>
          </div>
          {!data.entitlement.features.includes("analytics") && (
            <p className="text-xs mt-3 text-teal-800">
              Saving custom dashboards is available on Pro and Premium.
            </p>
          )}
        </section>
      )}
      {visible.includes("summary") && (
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
          {cards.map((c) => (
            <button
              key={c.key}
              disabled={role === "analyst"}
              onClick={() => onQueue(c.bucket)}
              className="text-left bg-white border border-slate-200 rounded-xl p-4 md:p-5 hover:shadow-md hover:border-teal-300 transition-all disabled:cursor-default"
            >
              <div className="flex justify-between items-center">
                <c.icon size={19} className={c.color} />
                <ArrowUpRight size={14} className="text-slate-300" />
              </div>
              <p className="text-3xl font-bold mt-5 tabular-nums">
                {data.summary[c.key] || 0}
              </p>
              <p className="text-xs text-slate-500 mt-1">{c.title}</p>
            </button>
          ))}
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-5">
        {visible.includes("trend") && (
          <section className="lg:col-span-2 rounded-xl bg-white border p-5 min-w-0">
            <div className="flex justify-between gap-2">
              <div>
                <h3 className="font-semibold">Ticket volume</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Created in the selected period · {data.range.timezone}
                </p>
              </div>
              <span className="text-teal-700 text-xl font-bold">
                {data.trend.reduce((n, r) => n + r.created, 0)}
              </span>
            </div>
            {data.trend.length ? (
              <svg
                viewBox="0 0 600 200"
                role="img"
                aria-label="Daily ticket creation trend"
                className="w-full h-56 mt-5"
              >
                <defs>
                  <linearGradient id="ticket-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity=".22" />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[30, 75, 120, 165].map((y) => (
                  <line
                    key={y}
                    x1="20"
                    x2="580"
                    y1={y}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeDasharray="3 5"
                  />
                ))}
                <polygon
                  points={`20,165 ${points} 580,165`}
                  fill="url(#ticket-area)"
                />
                <polyline
                  points={points}
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
                {data.trend.map((r, i) => (
                  <circle
                    key={r._id}
                    cx={
                      data.trend.length === 1
                        ? 300
                        : 20 + (i * 560) / (data.trend.length - 1)
                    }
                    cy={160 - (r.created / max) * 130}
                    r="4"
                    fill="#0d9488"
                  >
                    <title>
                      {r._id}: {r.created} tickets
                    </title>
                  </circle>
                ))}
                <text x="20" y="195" fontSize="11" fill="#64748b">
                  {data.trend[0]._id}
                </text>
                <text x="500" y="195" fontSize="11" fill="#64748b">
                  {data.trend[data.trend.length - 1]?._id}
                </text>
              </svg>
            ) : (
              <p className="text-slate-400 text-sm py-20 text-center">
                No tickets were created in this period.
              </p>
            )}
            <div className="grid grid-cols-2 border-t pt-4 gap-4">
              <div>
                <p className="text-xs text-slate-500">
                  Average first response · all tickets
                </p>
                <p className="text-lg font-semibold mt-1">
                  {mins(data.summary.firstResponseMinutes)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">
                  Average resolution · all tickets
                </p>
                <p className="text-lg font-semibold mt-1">
                  {mins(data.summary.resolutionMinutes)}
                </p>
              </div>
            </div>
          </section>
        )}
        {visible.includes("channels") && (
          <section className="bg-white border rounded-xl p-5">
            <h3 className="font-semibold">Conversations by channel</h3>
            <p className="text-xs text-slate-400 mt-1">
              New tickets in this period
            </p>
            <div className="mt-7 space-y-5">
              {data.channels.map((r) => (
                <div key={r._id}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="capitalize">{r._id}</span>
                    <span className="font-medium">{r.count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="bg-teal-500 h-full rounded-full"
                      style={{ width: `${sum ? (r.count / sum) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              {!sum && (
                <p className="text-sm text-slate-400">No conversations yet.</p>
              )}
            </div>
          </section>
        )}
      </div>
      <div className="grid xl:grid-cols-3 gap-5">
        {visible.includes("agents") && (
          <section className="xl:col-span-2 bg-white border rounded-xl overflow-hidden min-w-0">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-semibold">Agent workload</h3>
              <span className="text-xs text-slate-400">Current assignment</span>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {[
                      "Agent",
                      "Availability",
                      "Open",
                      "Resolved",
                      "First response",
                    ].map((h) => (
                      <th
                        className="text-left px-5 py-3 font-medium whitespace-nowrap"
                        key={h}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a._id} className="border-t">
                      <td className="px-5 py-4">
                        <div className="font-medium">{a.name || a.email}</div>
                        <p className="text-xs text-slate-400 mt-1">
                          Capacity {a.open || 0}/{a.capacity}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${a.online && !a.entitlementSuspended ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                        >
                          {a.entitlementSuspended
                            ? "Seat suspended"
                            : a.online
                              ? "Available"
                              : "Offline"}
                        </span>
                      </td>
                      <td className="px-5 py-4">{a.open || 0}</td>
                      <td className="px-5 py-4">{a.resolved || 0}</td>
                      <td className="px-5 py-4">{mins(a.responseMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {visible.includes("priorities") && (
          <section className="bg-white border rounded-xl p-5">
            <h3 className="font-semibold">Open ticket priorities</h3>
            <div className="mt-5 space-y-4">
              {["Critical", "High", "Medium", "Low"].map((p, i) => (
                <div className="flex items-center gap-3" key={p}>
                  <span
                    className={`w-2 h-2 rounded-full ${["bg-rose-500", "bg-orange-400", "bg-sky-500", "bg-slate-300"][i]}`}
                  />
                  <span className="text-sm flex-1">{p}</span>
                  <span className="font-semibold text-sm">
                    {data.priorities.find((r) => r._id === p)?.count || 0}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-7 p-3 bg-teal-50 rounded-lg text-xs text-teal-800 flex gap-2">
              <Activity size={16} />
              <p>
                Figures reflect your current workspace and role. Refreshes every
                30 seconds.
              </p>
            </div>
          </section>
        )}
      </div>
      {visible.includes("activity") && (
        <section className="bg-white border rounded-xl p-5">
          <h3 className="font-semibold mb-4">Recent workspace activity</h3>
          {data.activity.length ? (
            data.activity.map((a) => (
              <div
                key={a._id}
                className="flex justify-between gap-3 py-3 border-t text-sm"
              >
                <span className="capitalize">{label(a.action)}</span>
                <time className="text-xs text-slate-400">
                  {new Date(a.createdAt).toLocaleString()}
                </time>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">
              No activity visible for your role.
            </p>
          )}
        </section>
      )}
      <p className="text-xs text-slate-400 text-right">
        Updated {updated} · {data.entitlement.plan} workspace
      </p>
    </div>
  );
}
