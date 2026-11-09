import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { dashboardFetch } from "./dashboard-api.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "state-dir": { type: "string" },
    port: { type: "string" },
    "api-port": { type: "string" },
  },
});
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .parse(values.port ?? 7342);
const apiPort = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .parse(values["api-port"] ?? 7343);
const directory = path.resolve(
  values["state-dir"] ??
    path.join(homedir(), ".local/state/the-storm/promotion"),
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: apiPort,
  fetch: dashboardFetch(directory),
});
const ui = Bun.spawn(
  [
    process.execPath,
    "x",
    "--bun",
    "--no-install",
    "vite",
    "--config",
    "vite.promotion.config.ts",
    "--port",
    String(port),
  ],
  {
    cwd: path.resolve(import.meta.dir, "../../../alert-dashboard"),
    env: {
      ...Bun.env,
      PROMOTION_LOCAL_API_URL: `http://127.0.0.1:${String(apiPort)}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.stdout.write(
  `Promotion dashboard: http://127.0.0.1:${String(port)}/promotion\nReading local history from ${directory}\n`,
);
const stop = () => {
  ui.kill();
  void server.stop(true);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const code = await ui.exited;
await server.stop(true);
process.exitCode = code;
