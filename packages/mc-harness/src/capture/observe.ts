import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MC_DIR } from "#protocol/paths.ts";
import { withPublicationLock } from "#protocol/publication-lock.ts";
import {
  ClientCaptureResponseSchema,
  ClientStatusResponseSchema,
  ClientActionResponseSchema,
  type ClientStatusResponse,
} from "#protocol/client.ts";
import { InfoResponseSchema, PlayersResponseSchema } from "#protocol/bridge.ts";
import { SandboxListResponseSchema } from "#protocol/ipc.ts";
import { PresentationSchema } from "#protocol/media.ts";
import { CaptureTransport } from "./transport.ts";
import { RunSchema, initializeRun, save, type CaptureRun } from "./model.ts";
import { sha256 } from "./media.ts";
import { createCaptureSaver } from "./artifacts.ts";
import { assertNoPendingRun } from "./pending.ts";
import { isImportedWorld } from "#sandbox/map-provenance.ts";
import { createRecorder } from "./recording.ts";

type Options = {
  target: string;
  name: string;
  reason: string;
  seconds?: number;
};
type Transport = Pick<CaptureTransport, "request" | "world">;

async function mapProvenance(
  transport: Transport,
  run: CaptureRun,
  world: string,
): Promise<void> {
  if (run.target === "live") return;
  const { sandboxes } = await transport.request(
    SandboxListResponseSchema,
    "GET",
    "/sandboxes",
  );
  const sandbox = sandboxes.find((candidate) => candidate.id === run.target);
  if (
    sandbox?.world !== "real-map" ||
    !isImportedWorld(sandbox.mapSource, world, run.server)
  )
    throw new Error(
      "Observation publication requires the imported real-map world",
    );
  run.mapSource = sandbox.mapSource;
}

/** Observe the existing rendered view; never stage terrain, alter inventory or close a screen. */
export async function observeFrame(
  file: string,
  options: Options,
): Promise<CaptureRun> {
  if (options.seconds !== undefined)
    z.number().int().min(1).max(60).parse(options.seconds);
  const root = path.join(MC_DIR, "captures");
  const directory = path.join(root, `capture-${randomUUID()}`);
  const transport = new CaptureTransport(
    options.target,
    options.reason,
    undefined,
    options.name,
  );
  const initial = await transport.request(
    ClientStatusResponseSchema,
    "GET",
    `/clients/${options.name}`,
  );
  if (!initial.state.connected)
    throw new Error("Observation needs a connected rendered client");
  const position = initial.state.position.map((value) => Math.floor(value));
  const [x, y, zz] = z
    .tuple([z.number(), z.number(), z.number()])
    .parse(position);
  const run = RunSchema.parse({
    schema: 1,
    id: path.basename(directory),
    mode: "observation",
    target: options.target,
    name: options.name,
    reason: options.reason,
    inspectors: [],
    server: null,
    baseline: null,
    scene: path.resolve(file),
    sceneHash: await sha256(file),
    box: { world: "pending", min: { x, y, z: zz }, max: { x, y, z: zz } },
    anchor: [x, y, zz],
    state: "preflight",
    checkpoint: null,
    snapshot: null,
    inspection: null,
    origin: null,
    staging: null,
    cleanup: [],
    captures: [],
    error: "",
  });
  await mkdir(root, { recursive: true, mode: 0o700 });
  await initializeRun(directory, run);
  const lock = path.join(
    root,
    "locks",
    `${encodeURIComponent(run.target)}-${run.name}`,
  );
  await mkdir(lock, { recursive: true, mode: 0o700 });
  return withPublicationLock(lock, async () => {
    try {
      await assertNoPendingRun(directory, run);
      await observeCurrent(directory, run, transport, options.seconds);
      run.state = "complete";
    } catch (error) {
      run.state = "failed";
      run.error = error instanceof Error ? error.message : String(error);
    }
    await save(directory, run);
    return run;
  });
}

/** Injected transport keeps admission and the read-only route set testable. */
export async function observeCurrent(
  directory: string,
  run: CaptureRun,
  transport: Transport,
  seconds?: number,
): Promise<void> {
  const route = `/clients/${run.name}`;
  const read = async () =>
    transport.request(ClientStatusResponseSchema, "GET", route);
  const info = await transport.world(InfoResponseSchema, "info");
  run.server = info;
  const before = await read();
  if (
    before.client.target !== run.target ||
    !before.state.connected ||
    before.state.heldInputs.length > 0
  )
    throw new Error(
      "Observation needs the selected client at rest on the selected target",
    );
  const identity = z
    .object({
      uuid: z.uuid(),
      name: z.string(),
      renderedFrames: z.number(),
      terrainReady: z.boolean(),
    })
    .parse(before.state);
  const world = info.worlds.find(
    (candidate) => candidate.key === before.state.world,
  );
  if (world === undefined)
    throw new Error("Observed world is not advertised by the target server");
  const players = await transport.world(PlayersResponseSchema, "players");
  const participant = players.players.find(
    (player) =>
      player.name === run.name &&
      player.uuid === identity.uuid &&
      !player.npc &&
      player.world === world.name,
  );
  if (
    participant === undefined ||
    identity.name !== run.name ||
    (run.target === "live" && run.name !== "XiguaJerred")
  )
    throw new Error(
      "Observed client identity does not match the target server",
    );
  await mapProvenance(transport, run, world.name);
  run.server = info;
  run.box.world = world.name;
  run.origin = {
    world: world.key,
    position: before.state.position,
    yaw: before.state.yaw,
    pitch: before.state.pitch,
  };
  run.state = "capture";
  await save(directory, run);
  await waitForTerrain(read, world.key);
  const presentation = PresentationSchema.parse(
    await Bun.file(run.scene).json(),
  );
  const source = await observeSource(directory, run, transport, {
    presentation,
    seconds,
  });
  const after = await read();
  if (
    !after.state.connected ||
    after.state.world !== world.key ||
    after.state["uuid"] !== identity.uuid
  )
    throw new Error("Observation identity changed during capture");
  await Bun.write(
    path.join(directory, "observation.json"),
    JSON.stringify({ before: before.state, after: after.state }),
  );
  await createCaptureSaver(directory, run)(presentation, source);
}

async function observeSource(
  directory: string,
  run: CaptureRun,
  transport: Transport,
  options: {
    presentation: z.infer<typeof PresentationSchema>;
    seconds: number | undefined;
  },
): Promise<string> {
  const { presentation, seconds } = options;
  const route = `/clients/${run.name}`;
  if (seconds === undefined) {
    const capture = await transport.request(
      ClientCaptureResponseSchema,
      "POST",
      `${route}/capture`,
      {
        out: path.join(directory, `${presentation.name}.png`),
      },
    );
    return capture.path;
  }
  let source: string | undefined;
  const native = async (action: string, args: Record<string, unknown> = {}) => {
    const response = await transport.request(
      ClientActionResponseSchema,
      "POST",
      `${route}/${action}`,
      args,
    );
    return response.result;
  };
  await createRecorder(
    native,
    (_presentation, receipt) => {
      source = receipt;
      return Promise.resolve();
    },
    path.join(directory, "stop"),
  )(presentation, () => Promise.resolve(), seconds);
  if (source === undefined)
    throw new Error("Observation recording has no completed receipt");
  return source;
}

async function waitForTerrain(
  read: () => Promise<ClientStatusResponse>,
  world: string,
): Promise<void> {
  const deadline = performance.now() + 30_000;
  let terrainFrame: number | null = null;
  while (performance.now() < deadline) {
    const current = await read();
    if (!current.state.connected || current.state.world !== world)
      throw new Error("Observation client left the target world");
    const frames = z
      .object({ renderedFrames: z.number(), terrainReady: z.boolean() })
      .parse(current.state);
    if (frames.terrainReady) terrainFrame ??= frames.renderedFrames;
    else terrainFrame = null;
    if (
      terrainFrame !== null &&
      current.state.fps > 0 &&
      frames.renderedFrames >= terrainFrame + 3
    )
      return;
    await Bun.sleep(50);
  }
  throw new Error("Observation did not receive fresh rendered terrain");
}
