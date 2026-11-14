import { createWorkerShutdown } from "#lib/worker-shutdown.ts";

const directory = process.argv[2];
if (directory === undefined)
  throw new Error("Expected an owned fixture directory");
const events: string[] = [];
const received = Promise.withResolvers<undefined>();
const providerResponse = Promise.withResolvers<Response>();
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async () => {
    received.resolve(undefined);
    return await providerResponse.promise;
  },
});
const usagePath = `${directory}/usage.json`;
const run = (async () => {
  const response = await fetch(
    `http://127.0.0.1:${String(provider.port)}/fake-provider`,
  );
  const usage: unknown = await response.json();
  await Bun.write(usagePath, JSON.stringify(usage));
  events.push("usage persisted", "activity cleanup");
})();
const shutdown = createWorkerShutdown({
  workers: [
    {
      getState: () => "RUNNING",
      shutdown: () => {
        events.push("polling stopped");
        providerResponse.resolve(
          Response.json({
            inputTokens: 3,
            outputTokens: 1,
            fakeProvider: true,
          }),
        );
      },
    },
  ],
  runs: [run],
  closeIngress: () => {
    events.push("ingress closed");
    return Promise.resolve();
  },
  closeResources: async () => {
    await provider.stop(true);
    events.push("resources closed");
  },
  closeTracing: async () => {
    if (!(await Bun.file(usagePath).exists()))
      throw new Error("Tracing closed before usage persistence");
    events.push("tracing flushed");
  },
  closeCallGraph: () => {
    events.push("callgraph flushed");
    return Promise.resolve();
  },
});
const stopped = Promise.withResolvers<undefined>();
process.on("SIGTERM", () => {
  void (async () => {
    try {
      await shutdown();
      stopped.resolve(undefined);
    } catch (error) {
      stopped.reject(error);
    }
  })();
});
await received.promise;
process.stdout.write("READY\n");
await stopped.promise;
await Bun.write(`${directory}/events.json`, JSON.stringify(events));
process.stdout.write(
  JSON.stringify({
    offline: true,
    events,
    fakeProvider: true,
    usagePersisted: true,
  }) + "\n",
);
