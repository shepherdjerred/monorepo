import { z } from "zod";

import { argumentValue } from "#lib/cli.ts";
import { createApp } from "#server/app.ts";
import { createEvalStore } from "#server/store.ts";

const OptionsSchema = z.strictObject({
  databasePath: z.string().min(1),
  open: z.boolean(),
  port: z.coerce.number().int().min(1).max(65_535).default(7341),
});

const options = OptionsSchema.parse({
  databasePath:
    argumentValue("--database") ??
    Bun.env["SCOUT_EVAL_DATABASE_PATH"] ??
    new URL("../../data/scout-review-evals.sqlite", import.meta.url).pathname,
  open: Bun.argv.includes("--open"),
  port: argumentValue("--port"),
});

const store = createEvalStore(options.databasePath);
const app = createApp(store);
const server = Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: options.port,
});
const hostname = server.hostname;
if (hostname === undefined) throw new Error("Eval server has no hostname");
const url = `http://${hostname}:${String(server.port)}`;
console.warn(`Scout review evals: ${url}`);

if (options.open) {
  const openProcess = Bun.spawn(["open", url], {
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await openProcess.exited;
  if (exitCode !== 0) throw new Error(`open exited with ${String(exitCode)}`);
}

function shutdown(): void {
  store.close();
  void server.stop();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
