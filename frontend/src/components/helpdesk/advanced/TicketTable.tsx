import { useEffect, useRef, useState } from "react";
import {
  Inbox,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";
import api from "../../../utils/api";
interface Row {
  _id: string;
  number: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  version: number;
  updatedAt: string;
  contact?: { name?: string; email: string };
  assignedTo?: { _id: string; name?: string };
  sla: { breached: boolean };
}
type Run = (fn: () => Promise<void>, success?: string) => Promise<void>;
const control = "border rounded-lg bg-white px-3 py-2 text-sm min-w-0";
export default function TicketTable({
  workspaceId,
  role,
  statuses,
  run,
  onOpen,
}: {
  workspaceId: string;
  role: string;
  statuses: string[];
  run: Run;
  onOpen: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [priority, setPriority] = useState(""),
    [channel, setChannel] = useState(""),
    [mine, setMine] = useState(role === "agent"),
    [selected, setSelected] = useState<string[]>([]),
    [actionStatus, setActionStatus] = useState(""),
    [actionPriority, setActionPriority] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/workspaces/${workspaceId}`;
  const params = {
    page,
    limit: 30,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(channel ? { channel } : {}),
    ...(mine ? { mine: true } : {}),
  };
  const requestNumber = useRef(0);
  const currentParams = useRef(params);
  currentParams.current = params;
  const load = async () => {
    const request = ++requestNumber.current;
    const query = currentParams.current;
    setBusy(true);
    setSelected([]);
    try {
      const { data } = await api.get(base + "/tickets", { params: query });
      if (request !== requestNumber.current) return;
      setRows(data.tickets);
      setTotal(data.total);
      if (query.page > 1 && !data.tickets.length)
        setPage(Math.max(1, Math.ceil(data.total / 30)));
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  };
  useEffect(() => {
    const request = ++requestNumber.current;
    const controller = new AbortController();
    setBusy(true);
    setSelected([]);
    api
      .get(base + "/tickets", { params, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || request !== requestNumber.current)
          return;
        setRows(data.tickets);
        setTotal(data.total);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          void run(async () => {
            throw e;
          });
      })
      .finally(() => {
        if (!controller.signal.aborted && request === requestNumber.current)
          setBusy(false);
      });
    return () => controller.abort();
  }, [base, page, search, status, priority, channel, mine]);
  const change = (fn: () => void) => {
    setSelected([]);
    fn();
    setPage(1);
  };
  return (
    <section
      aria-busy={busy}
      className="bg-white border rounded-2xl overflow-hidden"
    >
      <div className="p-5 border-b flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold flex gap-2 items-center">
            <Inbox size={21} />
            Ticket queue
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {total} matching conversations
          </p>
        </div>
        <button
          disabled={busy}
          className={control}
          onClick={() => void run(load)}
        >
          Refresh queue
        </button>
      </div>
      <div className="p-4 flex flex-wrap gap-2 bg-slate-50">
        <label className="flex gap-2 items-center border rounded-lg px-3 bg-white flex-1">
          <Search size={16} />
          <input
            aria-label="Search table tickets"
            className="py-2 text-sm outline-none w-full"
            placeholder="Search subject or ticket number"
            value={search}
            onChange={(e) => change(() => setSearch(e.target.value))}
          />
        </label>
        <select
          aria-label="Table status"
          className={control}
          value={status}
          onChange={(e) => change(() => setStatus(e.target.value))}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Table priority"
          className={control}
          value={priority}
          onChange={(e) => change(() => setPriority(e.target.value))}
        >
          <option value="">All priorities</option>
          {["Low", "Medium", "High", "Critical"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Table channel"
          className={control}
          value={channel}
          onChange={(e) => change(() => setChannel(e.target.value))}
        >
          <option value="">All channels</option>
          {[
            "web",
            "chat",
            "email",
            "whatsapp",
            "phone",
            "instagram",
            "messenger",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {role !== "customer" && (
          <label className="text-sm flex items-center gap-2 px-2">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => change(() => setMine(e.target.checked))}
            />
            Assigned to me
          </label>
        )}
      </div>
      {["owner", "admin"].includes(role) && (
        <div className="p-3 border-b flex flex-wrap gap-2 items-center bg-teal-50">
          <span className="text-xs mr-2">{selected.length} selected</span>
          <select
            aria-label="Bulk ticket status"
            className={control}
            value={actionStatus}
            onChange={(e) => setActionStatus(e.target.value)}
          >
            <option value="">Set status…</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Bulk ticket priority"
            className={control}
            value={actionPriority}
            onChange={(e) => setActionPriority(e.target.value)}
          >
            <option value="">Set priority…</option>
            {["Low", "Medium", "High", "Critical"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            disabled={
              busy || !selected.length || (!actionStatus && !actionPriority)
            }
            className="bg-teal-700 rounded-lg px-4 py-2 text-sm text-white disabled:opacity-40"
            onClick={() =>
              void run(async () => {
                setBusy(true);
                try {
                  await api.post(base + "/tickets/bulk", {
                    tickets: rows
                      .filter((r) => selected.includes(r._id))
                      .map((r) => ({ id: r._id, version: r.version })),
                    actions: {
                      ...(actionStatus ? { status: actionStatus } : {}),
                      ...(actionPriority ? { priority: actionPriority } : {}),
                    },
                  });
                  await load();
                } finally {
                  setBusy(false);
                }
              }, "Selected tickets updated.")
            }
          >
            Apply to selected
          </button>
        </div>
      )}
      <div className="overflow-auto">
        <table className="w-full text-sm text-left min-w-[800px]">
          <thead className="text-xs text-slate-500 bg-slate-50">
            <tr>
              <th className="p-4">
                <input
                  type="checkbox"
                  aria-label="Select all page tickets"
                  disabled={busy}
                  checked={!!rows.length && selected.length === rows.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? rows.map((r) => r._id) : [])
                  }
                />
              </th>
              {[
                "Ticket",
                "Customer",
                "Status",
                "Priority",
                "Channel",
                "Assignee",
                "Updated",
              ].map((h) => (
                <th key={h} className="py-3 px-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="border-t hover:bg-teal-50/40">
                <td className="p-4">
                  <input
                    type="checkbox"
                    aria-label={"Select " + r.number}
                    disabled={busy}
                    checked={selected.includes(r._id)}
                    onChange={(e) =>
                      setSelected((v) =>
                        e.target.checked
                          ? [...v, r._id]
                          : v.filter((x) => x !== r._id),
                      )
                    }
                  />
                </td>
                <td className="p-4 max-w-xs">
                  <button
                    disabled={busy}
                    className="font-medium text-blue-700 text-left"
                    onClick={() => onOpen(r._id)}
                  >
                    {r.subject}
                    <ArrowUpRight size={13} className="inline ml-1" />
                  </button>
                  <p className="text-xs text-slate-400 mt-1">{r.number}</p>
                </td>
                <td className="p-4 text-xs">
                  {r.contact?.name || r.contact?.email || "Customer"}
                </td>
                <td className="p-4">
                  <span className="bg-slate-100 px-2 py-1 rounded text-xs whitespace-nowrap">
                    {r.status}
                  </span>
                  {r.sla.breached && (
                    <span className="block text-xs text-red-600 mt-1">
                      SLA breached
                    </span>
                  )}
                </td>
                <td
                  className={
                    "p-4 " +
                    (["Critical", "High"].includes(r.priority)
                      ? "text-red-700"
                      : "text-slate-500")
                  }
                >
                  {r.priority}
                </td>
                <td className="p-4 capitalize text-xs">{r.channel}</td>
                <td className="p-4 text-xs">
                  {r.assignedTo?.name || "Unassigned"}
                </td>
                <td className="p-4 text-xs whitespace-nowrap">
                  {new Date(r.updatedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="p-10 text-center text-slate-500">
          {busy ? "Loading tickets…" : "No matching tickets."}
        </p>
      )}
      <div className="p-4 border-t flex justify-between items-center text-xs">
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / 30))}
        </span>
        <div className="flex gap-2">
          <button
            aria-label="Previous table page"
            disabled={page === 1 || busy}
            className={control}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label="Next table page"
            disabled={page * 30 >= total || busy}
            className={control}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
