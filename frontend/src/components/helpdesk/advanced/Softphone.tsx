import { useEffect, useRef, useState } from "react";
import { Device, type Call } from "@twilio/voice-sdk";
import { Phone, PhoneOff, MicOff } from "lucide-react";
import api from "../../../utils/api";
type Run = (action: () => Promise<void>, success?: string) => Promise<void>;
interface Record {
  _id: string;
  direction: string;
  status: string;
  recordingSid?: string;
  transcription?: string;
  createdAt: string;
  transcriptionEnabled?: boolean;
}
export default function Softphone({
  base,
  ticketId,
  run,
}: {
  base: string;
  ticketId: string;
  run: Run;
}) {
  const device = useRef<Device | null>(null),
    active = useRef<Call | null>(null);
  const [status, setStatus] = useState("Ready to call"),
    [muted, setMuted] = useState(false),
    [records, setRecords] = useState<Record[]>([]),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await api.get<Record[]>(
      `${base}/tickets/${ticketId}/calls`,
    );
    setRecords(data);
  };
  useEffect(() => {
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => {
      clearInterval(timer);
      active.current?.disconnect();
      device.current?.destroy();
    };
  }, [base, ticketId]);
  const call = () =>
    run(async () => {
      setBusy(true);
      setMuted(false);
      try {
        device.current?.destroy();
        const { data } = await api.post(
          `${base}/tickets/${ticketId}/voice-token`,
        );
        const d = new Device(data.token, { logLevel: 0 });
        device.current = d;
        d.on("error", () => {
          setStatus("Call failed. Check microphone access and phone setup.");
          setBusy(false);
        });
        setStatus("Connecting…");
        const connection = await d.connect();
        active.current = connection;
        connection.on("accept", () => {
          setStatus("Connected");
          setBusy(false);
        });
        connection.on("disconnect", () => {
          setStatus("Call ended");
          setBusy(false);
          active.current = null;
          void load().catch(() => {});
        });
        connection.on("cancel", () => {
          setStatus("Call cancelled");
          setBusy(false);
          active.current = null;
        });
        connection.on("error", () => {
          setStatus("Call failed");
          setBusy(false);
        });
      } catch (e) {
        setBusy(false);
        setStatus("Unable to start the call");
        throw e;
      }
    });
  return (
    <section className="rounded-xl border bg-slate-50 p-4 space-y-3 mt-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium">Browser phone</h4>
        <span className="text-xs" role="status">
          {status}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Uses your microphone and the connected company phone number. Calls incur
        your provider’s charges.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="border rounded-lg px-3 py-2 text-sm flex gap-2"
          disabled={busy || !!active.current}
          onClick={() => void call()}
        >
          <Phone size={16} />
          Call customer
        </button>
        <button
          type="button"
          className="border rounded-lg px-3 py-2 text-sm flex gap-2"
          disabled={!active.current}
          onClick={() => {
            active.current?.mute(!muted);
            setMuted(!muted);
          }}
        >
          <MicOff size={16} />
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          className="border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex gap-2"
          disabled={!active.current}
          onClick={() => active.current?.disconnect()}
        >
          <PhoneOff size={16} />
          End call
        </button>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => void run(load)}
        >
          Refresh call history
        </button>
      </div>
      {active.current && (
        <div className="flex gap-1">
          {"123456789*0#".split("").map((d) => (
            <button
              type="button"
              key={d}
              className="border rounded p-2"
              onClick={() => active.current?.sendDigits(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {records.map((r) => (
        <div key={r._id} className="text-xs border-t pt-2 space-y-2">
          <p>
            {r.direction} · {r.status} ·{" "}
            {new Date(r.createdAt).toLocaleString()}
          </p>
          {r.transcription && (
            <p className="whitespace-pre-wrap">
              Voicemail transcript: {r.transcription}
            </p>
          )}
          {r.transcriptionEnabled && (
            <Transcript
              url={`${base}/tickets/${ticketId}/calls/${r._id}/transcript`}
              live={["ringing", "initiated", "in-progress"].includes(r.status)}
            />
          )}
          {r.recordingSid && (
            <button
              type="button"
              className="underline text-blue-700"
              onClick={() =>
                void run(async () => {
                  const { data } = await api.get(
                    `${base}/tickets/${ticketId}/calls/${r._id}/recording`,
                    { responseType: "blob" },
                  );
                  const url = URL.createObjectURL(data);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "support-call.mp3";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              Download private recording
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

type Utterance = { _id: string; text: string; track: string };
function Transcript({ url, live }: { url: string; live: boolean }) {
  const [open, setOpen] = useState(live),
    [rows, setRows] = useState<Utterance[]>([]),
    [more, setMore] = useState(true),
    [error, setError] = useState("");
  const cursor = useRef(""),
    loading = useRef(false),
    mounted = useRef(true);
  async function load() {
    if (loading.current) return;
    loading.current = true;
    try {
      const { data } = await api.get<Utterance[]>(url, {
        params: cursor.current ? { after: cursor.current } : {},
      });
      if (!mounted.current) return;
      if (data.length) cursor.current = data[data.length - 1]._id;
      setRows((old) => {
        const ids = new Set(old.map((u) => u._id));
        return [...old, ...data.filter((u) => !ids.has(u._id))];
      });
      setMore(data.length === 200);
      setError("");
    } catch {
      if (mounted.current) setError("Unable to load transcript. Try again.");
    } finally {
      loading.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    void load();
    if (!live) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [url, open, live]);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer">
        Conversation transcript{live ? " · live" : ""}
      </summary>
      <div className="space-y-1 mt-2" aria-label="Live conversation transcript">
        {rows.map((u) => (
          <p key={u._id}>
            <span className="text-slate-500">
              {u.track === "inbound_track"
                ? "Incoming audio"
                : "Outgoing audio"}
              :
            </span>{" "}
            {u.text}
          </p>
        ))}
        {!rows.length && !error && <p>No final transcript segments yet.</p>}
        {error && <p role="status">{error}</p>}
        {(more || error) && (
          <button
            type="button"
            className="underline"
            onClick={() => void load()}
          >
            Load more transcript
          </button>
        )}
      </div>
    </details>
  );
}
