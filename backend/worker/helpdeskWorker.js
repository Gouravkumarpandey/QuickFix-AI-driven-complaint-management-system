import "dotenv/config";
import mongoose from "mongoose";
import { drainJobs, checkSLAs } from "../src/helpdesk/jobs.js";
import { syncMailboxes } from "../src/helpdesk/mailbox.js";
import { reconcileAllSeats } from "../src/helpdesk/entitlements.js";
import { WorkerHeartbeat } from "../src/helpdesk/models.js";
await mongoose.connect(process.env.MONGODB_URI);
let running = true;
const heartbeatTimer = setInterval(() => {
  WorkerHeartbeat.updateOne(
    { name: "helpdesk" },
    { $set: { lastSeen: new Date() } },
    { upsert: true },
  ).catch(() => {});
}, 30000);
heartbeatTimer.unref();
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  try {
    await WorkerHeartbeat.findOneAndUpdate(
      { name: "helpdesk" },
      { $set: { lastSeen: new Date(), lastError: "" } },
      { upsert: true },
    );
    await reconcileAllSeats();
    await checkSLAs();
    await drainJobs();
    await syncMailboxes();
  } catch (error) {
    console.error("Helpdesk worker:", error.message);
    await WorkerHeartbeat.findOneAndUpdate(
      { name: "helpdesk" },
      {
        $set: {
          lastSeen: new Date(),
          lastError: "A worker task failed; inspect operator logs",
        },
      },
      { upsert: true },
    ).catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
clearInterval(heartbeatTimer);
await mongoose.disconnect();
