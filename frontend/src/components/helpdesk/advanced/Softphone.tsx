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
  const load = async () =>
    setRecords((await api.get(`${base}/tickets/${ticketId}/calls`)).data);
  useEffect(() => {
    void load().catch(() => {});
    return () => {
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
