import crypto from "node:crypto";
// Operator opt-in only. Sends aggregate service status, never customer content.
const url = process.env.MONITOR_READY_URL || "http://localhost:5000/api/ready";
let prior;
while (true) {
  let state;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    state = { healthy: r.ok, ...(await r.json()) };
  } catch {
    state = { healthy: false, error: "API readiness check failed" };
  }
  const key = JSON.stringify(state);
  if (key !== prior) {
    console.log(
      new Date().toISOString(),
      state.healthy ? "healthy" : "unhealthy",
    );
    if (process.env.MONITOR_WEBHOOK_URL) {
      const webhook = new URL(process.env.MONITOR_WEBHOOK_URL);
      if (webhook.protocol !== "https:")
        throw new Error("Monitoring webhook requires HTTPS");
      const body = JSON.stringify({
        service: "QuickFix",
        time: new Date(),
        state,
      });
      try {
        const r = await fetch(webhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.MONITOR_WEBHOOK_SECRET
              ? {
                  "X-QuickFix-Signature":
                    "sha256=" +
                    crypto
                      .createHmac("sha256", process.env.MONITOR_WEBHOOK_SECRET)
                      .update(body)
                      .digest("hex"),
                }
              : {}),
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error("Alert rejected");
        prior = key;
      } catch {
        console.error(
          "Monitoring alert delivery failed; retrying next interval",
        );
      }
    } else prior = key;
  }
  await new Promise((resolve) => setTimeout(resolve, 60000));
}
