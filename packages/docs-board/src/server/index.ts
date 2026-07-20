import { z } from "zod";

import { createApp } from "#server/app";
import { DocumentStore } from "#server/document-store";

const OptionsSchema = z.object({
  port: z.coerce.number().int().min(1).max(65_535).default(7331),
  open: z.boolean(),
});

function parseOptions(): z.infer<typeof OptionsSchema> {
  const portIndex = Bun.argv.indexOf("--port");
  const port = portIndex === -1 ? undefined : Bun.argv[portIndex + 1];
  return OptionsSchema.parse({ port, open: Bun.argv.includes("--open") });
}

async function repositoryRoot(): Promise<string> {
  const process = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(`Cannot find repository: ${stderr.trim()}`);
  return stdout.trim();
}

const options = parseOptions();
const store = new DocumentStore({ repoRoot: await repositoryRoot() });
const app = createApp(store);
const server = Bun.serve({
  hostname: "127.0.0.1",
  idleTimeout: 255,
  port: options.port,
  fetch: app.fetch,
});
const hostname = server.hostname;
if (hostname === undefined)
  throw new Error("Docs Board server has no hostname");
const url = `http://${hostname}:${String(server.port)}`;
console.log(`Docs Board: ${url}`);

if (options.open) {
  const process = Bun.spawn(["open", url], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`open exited with ${String(exitCode)}`);
}

function shutdown(): void {
  store.close();
  void server.stop();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
