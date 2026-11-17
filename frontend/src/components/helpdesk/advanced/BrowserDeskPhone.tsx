import { useEffect, useRef, useState } from "react";
import { Device, type Call } from "@twilio/voice-sdk";
import api from "../../../utils/api";
export default function BrowserDeskPhone({
  workspaceId,
  onOpen,
}: {
  workspaceId: string;
  onOpen: (id: string) => void;
}) {
  const device = useRef<Device | null>(null),
    active = useRef<Call | null>(null),
    lease = useRef(""),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    generation = useRef(0);
  const [status, setStatus] = useState("Phone offline"),
    [registered, setRegistered] = useState(false),
    [ringing, setRinging] = useState(false),
    [connected, setConnected] = useState(false),
    [muted, setMuted] = useState(false),
    [busy, setBusy] = useState(false);
  const url = `/workspaces/${workspaceId}/voice/desk`;
  function stop() {
    generation.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    active.current?.disconnect();
    active.current = null;
    device.current?.destroy();
    device.current = null;
    const id = lease.current;
    lease.current = "";
    if (id) void api.delete(url, { data: { sessionId: id } }).catch(() => {});
    setRegistered(false);
    setRinging(false);
    setConnected(false);
    setBusy(false);
    setStatus("Phone offline");
  }
  useEffect(() => () => stop(), [workspaceId]);
  async function start() {
    setBusy(true);
    const gen = ++generation.current;
    try {
      const { data } = await api.post(url, {});
      if (gen !== generation.current) {
        void api.delete(url, { data: { sessionId: data.sessionId } });
        return;
      }
      lease.current = data.sessionId;
      const d = new Device(data.token, { logLevel: 0 });
      device.current = d;
      d.on("registered", () => {
        setRegistered(true);
        setBusy(false);
        setStatus("Ready for incoming calls");
      });
      d.on("error", () => {
        stop();
        setStatus(
          "Phone disconnected. Check your microphone and provider configuration.",
        );
      });
      d.on("incoming", (call: Call) => {
        if (active.current) {
          call.reject();
          return;
        }
        active.current = call;
        setRinging(true);
        setMuted(false);
        setStatus("Incoming support call");
        const ended = () => {
          active.current = null;
          setRinging(false);
          setConnected(false);
          setStatus("Ready for incoming calls");
        };
        call.on("cancel", ended);
        call.on("disconnect", ended);
        call.on("reject", ended);
        call.on("error", ended);
        call.on("accept", () => {
          setRinging(false);
          setConnected(true);
          setStatus("Call connected");
          const id = call.customParameters.get("ticketId");
          if (id && /^[a-f0-9]{24}$/i.test(id)) onOpen(id);
        });
      });
      await d.register();
      if (gen !== generation.current) return;
      timer.current = setInterval(() => {
        void api
          .post(url, { sessionId: lease.current })
          .then(({ data }) => {
            if (gen === generation.current) d.updateToken(data.token);
          })
          .catch(() => {
            if (gen === generation.current) {
              stop();
              setStatus(
                "Phone availability expired. Reconnect to receive calls.",
              );
            }
          });
      }, 30000);
    } catch (e) {
      if (gen === generation.current) {
        stop();
        setStatus(
          (e as { response?: { data?: { message?: string } } }).response?.data
            ?.message ||
            "Unable to connect the phone. Configure browser calling first.",
        );
      }
    }
  }
  return (
    <section
      className="mb-4 rounded-xl border bg-white p-3 flex flex-wrap items-center gap-3 text-sm"
      aria-label="Incoming browser phone"
    >
      <span
        role="status"
        className={
          ringing
            ? "font-semibold text-blue-700 animate-pulse"
            : "text-slate-600"
        }
      >
        {status}
      </span>
      {!registered ? (
        <button
          className="rounded border px-3 py-1"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? "Connecting…" : "Receive calls in browser"}
        </button>
      ) : (
        <button className="rounded border px-3 py-1" onClick={stop}>
          Go offline
        </button>
      )}
      {ringing && (
        <>
          <button
            className="rounded bg-green-700 text-white px-3 py-1"
            onClick={() => active.current?.accept()}
          >
            Answer call
          </button>
          <button
            className="rounded border text-red-700 px-3 py-1"
            onClick={() => active.current?.reject()}
          >
            Decline
          </button>
        </>
      )}
      {connected && (
        <>
          <button
            className="rounded border px-3 py-1"
            onClick={() => {
              active.current?.mute(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            className="rounded border text-red-700 px-3 py-1"
            onClick={() => active.current?.disconnect()}
          >
            End call
          </button>
        </>
      )}
    </section>
  );
}
