import cron from "node-cron";
import { checkWatches } from "./checker.js";

const CHECK_INTERVAL = process.env.CHECK_INTERVAL || "*/15 * * * *"; // Every 15 minutes by default

console.log("🏕️  Camping Reservation Scheduler");
console.log(`Schedule: ${CHECK_INTERVAL}`);
console.log("---");

// Run immediately on startup
console.log("Running initial check...");
checkWatches().catch(console.error);

// Schedule periodic checks
const task = cron.schedule(CHECK_INTERVAL, () => {
  checkWatches().catch(console.error);
});

console.log("Scheduler started. Press Ctrl+C to stop.");

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down scheduler...");
  task.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down scheduler...");
  task.stop();
  process.exit(0);
});
