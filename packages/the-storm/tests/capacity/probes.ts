import { z } from "zod";
import path from "node:path";
import {
  docker,
  serverLogs,
} from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { mkdir } from "node:fs/promises";
import type { ServerInfo } from "#e2e/harness/server.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { packageRoot } from "#e2e/harness/paths.ts";
import { capacityMap, capacityResources } from "#e2e/gameplay-fixtures.ts";
import { sampleWindow } from "#load/samples.ts";
import {
  MemorySchema,
  TelemetrySchema,
  type Memory,
  type Telemetry,
  type Lifecycle,
} from "./capacity-bars.ts";
import { recordFlight } from "#e2e/harness/flight.ts";

/** Optional post-measurement diagnostics, always separate from release acceptance. */
export async function profileAfterMeasurement(
  server: ServerInfo,
  matchId: string,
) {
  const raw = Bun.env["STORM_CAPACITY_PROFILE"];
  if (raw === undefined) return;
  const mode = z.enum(["cpu", "alloc", "jfr"]).parse(raw);
  if (Bun.env["STORM_CAPACITY_PROBE_TOTAL"] === undefined)
    throw new Error(
      "Profiling is only allowed in an incomplete calibration probe",
    );
  if (server.kind !== "container") throw new Error("Profiling requires Docker");
  if (mode === "jfr") {
    await recordFlight(server, matchId);
    return;
  }
  const command = (text: string) =>
    docker([
      "exec",
      "-u",
      "1000",
      server.containerId,
      "mc-send-to-console",
      text,
    ]);
  const began = Date.now();
  await command(
    `spark profiler start --thread *${mode === "alloc" ? " --alloc" : ""}`,
  );
  try {
    await Bun.sleep(90_000);
  } finally {
    await command("spark profiler stop --save-to-file");
  }
  const deadline = Date.now() + 30_000;
  for (;;) {
    const logs = await serverLogs(server);
    if (logs.includes(".sparkprofile")) break;
    if (Date.now() > deadline)
      throw new Error("Spark did not save its profile");
    await Bun.sleep(500);
  }
  const files = await docker([
    "exec",
    server.containerId,
    "find",
    "/data",
    "-maxdepth",
    "4",
    "-type",
    "f",
    "-name",
    "*.sparkprofile",
  ]);
  const paths = files.stdout.trim().split("\n");
  if (paths.length !== 1 || paths[0]?.startsWith("/data/") !== true)
    throw new Error(
      `Expected one saved Spark profile, found ${paths.length.toString()}`,
    );
  const out = path.join(packageRoot, ".cache/e2e/capacity/profiles", matchId);
  await mkdir(out, { recursive: true });
  await docker([
    "cp",
    `${server.containerId}:${paths[0]}`,
    path.join(out, `${mode}.sparkprofile`),
  ]);
  await command("spark gc");
  await Bun.sleep(1000);
  await Bun.write(path.join(out, "console.log"), await serverLogs(server));
  await Bun.write(
    path.join(out, "profile.json"),
    JSON.stringify(
      {
        mode,
        matchId,
        began,
        ended: Date.now(),
        postMeasurement: true,
      },
      null,
      2,
    ),
  );
  console.warn(`Post-measurement diagnostics: ${out}`);
}

/** Bind local evidence to the actual binary, catalog, navigation and enforced resource limits. */
export async function evidence(server: ServerInfo) {
  if (server.kind !== "container")
    throw new Error("Capacity evidence requires Docker");
  const { stdout } = await docker([
    "inspect",
    "--format",
    "{{json .HostConfig}}",
    server.containerId,
  ]);
  const limits = z
    .object({
      NanoCpus: z.literal(capacityResources().cpus * 1_000_000_000),
      Memory: z.literal(10 * 1024 ** 3),
    })
    .parse(JSON.parse(stdout));
  const digest = async (relative: string, staged: string) => {
    const bytes = await Bun.file(
      path.join(packageRoot, relative),
    ).arrayBuffer();
    const local = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const copied = await docker([
      "exec",
      server.containerId,
      "sha256sum",
      staged,
    ]);
    const actual = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(copied.stdout.split(/\s+/u)[0]);
    if (actual !== local)
      throw new Error(`Staged capacity input differs from ${relative}`);
    return actual;
  };
  const manifestFile =
    "server/owned/plugins/TheStorm/rwfbots/personalities/manifest.json";
  const manifest = z
    .object({ personalities: z.array(z.unknown()) })
    .parse(await Bun.file(path.join(packageRoot, manifestFile)).json());
  return {
    artifactSha256: await digest(
      "plugin/dist/build/libs/TheStorm.jar",
      "/data/plugins/TheStorm.jar",
    ),
    personalityManifestSha256: await digest(
      manifestFile,
      "/data/plugins/TheStorm/rwfbots/personalities/manifest.json",
    ),
    personalityCount: manifest.personalities.length,
    navigationSha256: await digest(
      `server/owned/plugins/TheStorm/rwf/maps/${capacityMap()}/nav.rwfnav`,
      `/data/plugins/TheStorm/rwf/maps/${capacityMap()}/nav.rwfnav`,
    ),
    enforcedLimits: limits,
  };
}

/** Keep arrival and reset costs distinct from the settled live measuring window. */
export async function lifecycle(
  server: ServerInfo,
  ready: () => Promise<boolean>,
  timeoutMs: number,
): Promise<Lifecycle> {
  const began = Date.now();
  const result: Lifecycle = { elapsedMs: 0, windows: [], memory: [] };
  let nextWindow = began + 10_000;
  while (!(await ready())) {
    if (Date.now() - began > timeoutMs)
      throw new Error("Lifecycle phase timed out");
    const tick = Date.now();
    result.memory.push(await memory(server));
    if (Date.now() >= nextWindow) {
      result.windows.push(await sampleWindow(server));
      nextWindow += 10_000;
    }
    await Bun.sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  result.memory.push(await memory(server));
  result.elapsedMs = Date.now() - began;
  return result;
}

const TelemetryReply = z
  .string()
  .transform((reply, context) => {
    const match =
      /load observations (?<observations>\d+); age p95 (?<ageP95>\d+); age max (?<ageMax>\d+); pending max (?<pendingMax>\d+); lag p95 (?<lagP95>\d+); governor max (?<governorMax>\d+); overruns (?<overruns>\d+); think max (?<thinkMax>[\d.]+) ms; heap peak (?<heapPeak>\d+) bytes; heap limit (?<heapLimit>\d+) bytes/u.exec(
        reply,
      );
    if (match?.groups === undefined) {
      context.addIssue({
        code: "custom",
        message: `Missing load diagnostics: ${reply}`,
      });
      return z.NEVER;
    }
    return Object.fromEntries(
      Object.entries(match.groups).map(([k, v]) => [k, Number(v)]),
    );
  })
  .pipe(TelemetrySchema);

export async function telemetry(rcon: RconClient): Promise<Telemetry> {
  return TelemetryReply.parse(await rcon.command("rwfbots debug load"));
}

/** Read and start the next interval in one main-thread operation, without losing worker jobs. */
export async function drainTelemetry(rcon: RconClient): Promise<Telemetry> {
  return TelemetryReply.parse(await rcon.command("rwfbots debug load reset"));
}

export async function memory(server: ServerInfo): Promise<Memory> {
  if (server.kind !== "container")
    throw new Error(
      "Capacity acceptance requires its disposable Docker container",
    );
  const { stdout } = await docker([
    "exec",
    server.containerId,
    "cat",
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory.peak",
    "/sys/fs/cgroup/memory.max",
  ]);
  const values = z
    .array(z.coerce.number().int().positive())
    .length(3)
    .parse(stdout.trim().split(/\s+/u));
  return MemorySchema.parse({
    current: values[0],
    peak: values[1],
    limit: values[2],
  });
}
