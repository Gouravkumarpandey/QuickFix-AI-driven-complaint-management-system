import "dotenv/config";
import mongoose from "mongoose";
import { drainJobs, checkSLAs } from "../src/helpdesk/jobs.js";
await mongoose.connect(process.env.MONGODB_URI);
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  try {
    await checkSLAs();
    await drainJobs();
  } catch (error) {
    console.error("Helpdesk worker:", error.message);
  }
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
await mongoose.disconnect();
