import { z } from "zod";
import { FlagsDeploymentSchema } from "#protocol/ipc.ts";
import { retainBlob, cachedBlob, type BlobStore } from "./store.ts";
import { command } from "./process.ts";

/** Linux containers reach a host reader through the default bridge, not host loopback. */
export async function rolloutListenHost(
  platform: NodeJS.Platform = process.platform,
  inspect: (argv: string[]) => Promise<string> = command,
): Promise<string> {
  if (platform !== "linux") return "127.0.0.1";
  const configs = z
    .array(z.object({ Gateway: z.union([z.ipv4(), z.ipv6()]) }))
    .parse(
      JSON.parse(
        await inspect([
          "docker",
          "network",
          "inspect",
          "bridge",
          "--format",
          "{{json .IPAM.Config}}",
        ]),
      ),
    );
  const gateway = configs
    .map((config) => config.Gateway)
    .find((value) => z.ipv4().safeParse(value).success);
  if (gateway === undefined)
    throw new Error(
      "Docker's default bridge needs an IPv4 gateway for capture rollout",
    );
  return gateway;
}

const RequestSchema = z.strictObject({
  deployment: FlagsDeploymentSchema,
  key: z.string().min(1),
  context: z.record(z.string(), z.string()).default({}),
});
const EntrySchema = z.strictObject({
  key: z.string(),
  status: z.number().int(),
  body: z.string(),
});
export const RolloutSnapshotSchema = z.strictObject({
  schema: z.literal(1),
  deployment: FlagsDeploymentSchema,
  entries: z.array(EntrySchema),
});
function requestKey(value: z.infer<typeof RequestSchema>): string {
  return JSON.stringify({
    deployment: value.deployment,
    key: value.key,
    context: Object.fromEntries(
      Object.entries(value.context).toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

/** Record each effective decision once; replay never contacts the upstream reader. */
export async function localRollout(
  options: {
    source?: { url: string; deployment: string };
    snapshot?: string;
    store: BlobStore;
    cache: string;
  },
  listenHost: () => Promise<string> = rolloutListenHost,
) {
  const restored =
    options.snapshot === undefined
      ? undefined
      : RolloutSnapshotSchema.parse(
          await Bun.file(
            await cachedBlob(options.store, options.cache, options.snapshot),
          ).json(),
        );
  const rawDeployment = restored?.deployment ?? options.source?.deployment;
  if (
    rawDeployment === undefined ||
    (restored === undefined && options.source === undefined)
  )
    throw new Error("Rollout reader needs a source or retained snapshot");
  const deployment = FlagsDeploymentSchema.parse(rawDeployment);
  const entries = new Map(restored?.entries.map((entry) => [entry.key, entry]));
  const pending = new Map<string, Promise<z.infer<typeof EntrySchema>>>();
  const errors: string[] = [];
  const resolve = async (key: string, input: z.infer<typeof RequestSchema>) => {
    if (restored !== undefined || options.source === undefined)
      throw new Error(`Unrecorded rollout decision ${input.key}`);
    const response = await fetch(new URL("/v1/evaluate", options.source.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    const entry = { key, status: response.status, body: await response.text() };
    if (response.status !== 200)
      throw new Error(
        `Rollout evaluation returned ${response.status.toString()}`,
      );
    z.object({ enabled: z.boolean() }).parse(JSON.parse(entry.body));
    entries.set(key, entry);
    return entry;
  };
  const server = Bun.serve({
    hostname: await listenHost(),
    port: 0,
    fetch: async (request) => {
      try {
        if (
          request.method !== "POST" ||
          new URL(request.url).pathname !== "/v1/evaluate"
        )
          return new Response("Unsupported evaluation", { status: 404 });
        const input = RequestSchema.parse(await request.json());
        if (input.deployment !== deployment)
          throw new Error(
            `Rollout deployment ${input.deployment} differs from ${deployment}`,
          );
        const key = requestKey(input);
        let entry = entries.get(key);
        if (entry === undefined) {
          let evaluation = pending.get(key);
          if (evaluation === undefined) {
            evaluation = resolve(key, input);
            pending.set(key, evaluation);
          }
          try {
            entry = await evaluation;
          } finally {
            pending.delete(key);
          }
        }
        return new Response(entry.body, {
          status: entry.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return new Response("Capture rollout failed", { status: 503 });
      }
    },
  });
  const port = z.number().int().positive().parse(server.port);
  return {
    bootstrap: {
      url: `http://host.docker.internal:${port.toString()}`,
      deployment,
    },
    retain: async () => {
      await Promise.all(pending.values());
      if (errors.length > 0) throw new Error(errors.join("; "));
      const snapshot = RolloutSnapshotSchema.parse({
        schema: 1,
        deployment,
        entries: [...entries.values()],
      });
      return retainBlob(
        options.store,
        new TextEncoder().encode(JSON.stringify(snapshot)),
      );
    },
    stop: async () => {
      await server.stop();
    },
  };
}
