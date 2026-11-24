import { startStormStatsServer } from "./server/index.ts";

const running = await startStormStatsServer();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.warn(`storm-stats received ${signal}; shutting down`);
  await running.stop();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
