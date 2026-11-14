import { exitAfterDrain } from "#lib/worker-exit.ts";
import { createWorkerShutdown } from "#lib/worker-shutdown.ts";

const DRAIN_MS = 1500;
const activity = Promise.withResolvers<undefined>();
// Nothing ever stops this server: it stands in for a handle the shutdown
// path forgot, which is what kept worker pods alive until SIGKILL.
Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response("leaked"),
});
const close = () => Promise.resolve();
const shutdown = createWorkerShutdown({
  workers: [
    {
      getState: () => "RUNNING",
      shutdown: () => {
        setTimeout(() => {
          activity.resolve(undefined);
        }, DRAIN_MS);
      },
    },
  ],
  runs: [activity.promise],
  closeIngress: close,
  closeResources: close,
  closeConnections: close,
  closeTracing: close,
  closeCallGraph: close,
  afterDrain: () => {
    // Synchronous on purpose: the process may be forced out before an
    // asynchronous write settles.
    process.stdout.write(`DRAINED ${String(Date.now())}\n`);
    exitAfterDrain({
      graceMs: 250,
      onForcedExit: (fields) => {
        process.stdout.write(`FORCED ${JSON.stringify(fields)}\n`);
      },
    });
  },
});
process.on("SIGTERM", () => {
  void shutdown();
});
process.stdout.write("READY\n");
