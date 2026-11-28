import type { ReplayResources } from "@scout-for-lol/replay/engine";
import { ReplayCapabilityError } from "@scout-for-lol/replay/types";
import { z } from "zod";
import { makeRibbonSampler } from "./recorded-rift-ribbon.mjs";
import type { TerrainScene } from "./scout-terrain-scene.ts";
import { createNavgridGroundHeight } from "./tools/research/native-terrain-ground.mjs";
import { reachesRiftProjectileTarget } from "./tools/research/recorded-rift-projectile-terminal.mjs";

const format = "16.23.841.8428";
const png = z.string().regex(/^recorded-particles\/[a-f0-9]{64}\.png$/u);
const resourceSchema = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("recorded-rift-ribbon-resource"),
  build: z.literal(format),
  mapId: z.literal(11),
  texture: png,
  palette: png,
});
const integer = z.number().int().nonnegative();
const actor = integer.positive().max(0xffff_ffff);
const seconds = z.number().nonnegative();
const float32 = z.number().refine((value) => Math.fround(value) === value);
const vector = z.tuple([float32, float32, float32]);
type Vector = z.infer<typeof vector>;
const prefixSchema = z.object({
  launch: z.object({
    entity: actor,
    sourceContext: actor,
    sourceName: z.literal("Maokai"),
    requestedMissileSpellHash: z.literal(0x0187cc63),
    castSourceXYZ: vector,
    castTargetXYZ: vector,
    forcedRecordedSource: z.literal(true),
    packetElapsedSeconds: z.literal(0),
  }),
  launchSequence: integer,
  startSeconds: seconds,
  birthMaskSequences: z.array(integer).min(1),
  packetBoundary: z.object({
    sequence: integer,
    opcode: integer,
    timeSeconds: seconds,
  }),
});
const resultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(false), message: z.string().nonempty() }),
  z.strictObject({ ok: z.literal(true), prefixes: z.array(prefixSchema) }),
]);
type Prefix = z.infer<typeof prefixSchema>;
const emitter = {
  lifetime: 5,
  particleLifetime: Math.fround(0.36),
  birthColor: [67 / 255, 70 / 255, 134 / 255, 133 / 255].map(Math.fround),
  birthScale0: [150, 100, 0],
  offset: [0, -60, 25],
  trailCutoff: 2000,
  trailMode: 2,
  trailSmoothing: 1,
  trailTiling: [2500, 0, 0],
};
const maximumLifetime = emitter.lifetime + emitter.particleLifetime;
const initialSpeed = 100;
const speedCap = 750;
const acceleration = 300;
const rampDuration = (speedCap - initialSpeed) / acceleration;
const f32 = Math.fround;

function invalidPackage(message: string) {
  return new ReplayCapabilityError("invalid-package", message);
}

async function readPrefixShard(
  resources: ReplayResources,
  replay: ArrayBuffer,
  pageBytes: ArrayBuffer,
  signal: AbortSignal,
  verifiedOwners: number[],
  shardIndex: number,
  shardCount: number,
) {
  signal.throwIfAborted();
  const worker = await resources.worker("rift-projectile-worker.mjs");
  let onAbort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const output = await new Promise<unknown>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      worker.addEventListener(
        "message",
        ({ data }: MessageEvent<unknown>) => resolve(data),
        { once: true },
      );
      const fail = () =>
        reject(invalidPackage("The Rift projectile worker failed."));
      worker.addEventListener("error", fail, { once: true });
      worker.addEventListener("messageerror", fail, { once: true });
      const copy = replay.slice(0);
      const pages = pageBytes.slice(0);
      worker.postMessage(
        { replay: copy, pages, verifiedOwners, shardIndex, shardCount },
        [copy, pages],
      );
    });
    signal.throwIfAborted();
    const result = resultSchema.safeParse(output);
    if (!result.success)
      throw invalidPackage("The Rift projectile worker returned invalid data.");
    if (!result.data.ok) throw invalidPackage(result.data.message);
    return result.data.prefixes;
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    worker.terminate();
  }
}

async function readPrefixes(
  resources: ReplayResources,
  replay: ArrayBuffer,
  signal: AbortSignal,
  verifiedOwners: number[],
) {
  const pages = (await resources.read("rift-projectile-pages.bin")).slice()
    .buffer;
  const shardCount = 3;
  // Every shard observes the complete envelope order. Only the native
  // creation decoder is divided, so termination stays causal per actor.
  const shards = await Promise.all(
    Array.from({ length: shardCount }, (_, index) =>
      readPrefixShard(
        resources,
        replay,
        pages,
        signal,
        verifiedOwners,
        index,
        shardCount,
      ),
    ),
  );
  return shards.flat().sort((a, b) => a.launchSequence - b.launchSequence);
}

function createFlight(
  { launch, startSeconds, packetBoundary }: Prefix,
  groundAt: (x: number, z: number) => number | null,
) {
  const origin = launch.castSourceXYZ;
  const [x, y, z] = origin;
  const [targetX, , targetZ] = launch.castTargetXYZ;
  const ground = groundAt(targetX, targetZ);
  const offset = f32(y - (groundAt(x, z) ?? 0));
  const rebasedY = f32((ground ?? 0) + offset);
  const target: Vector = [
    targetX,
    ground !== null && rebasedY < ground ? f32(ground + 4) : rebasedY,
    targetZ,
  ];
  const dx = f32(target[0] - x);
  const dy = f32(target[1] - y);
  const dz = f32(target[2] - z);
  const horizontal = f32(Math.sqrt(f32(f32(dx * dx) + f32(dz * dz))));
  if (!(horizontal > 0) || !Number.isFinite(horizontal)) return undefined;
  const direction: Vector = [
    f32(dx / horizontal),
    f32(dy / horizontal),
    f32(dz / horizontal),
  ];
  if (!direction.every(Number.isFinite)) return undefined;
  const duration = packetBoundary.timeSeconds - startSeconds;
  const ticks = Math.ceil(duration * 120);
  const inputStep = f32(duration / ticks);
  let position = origin;
  let speed = initialSpeed;
  const frames = [
    { age: 0, position, velocity: direction.map((lane) => f32(lane * speed)) },
  ];
  for (let tick = 1; tick <= ticks; tick++) {
    const age = (duration * tick) / ticks;
    const ramp = Math.min(age, rampDuration);
    const distance =
      initialSpeed * ramp +
      (acceleration * ramp ** 2) / 2 +
      speedCap * (age - ramp);
    const next: Vector = [
      f32(x + direction[0] * distance),
      f32(y + direction[1] * distance),
      f32(z + direction[2] * distance),
    ];
    const delta: Vector = [
      f32(next[0] - position[0]),
      f32(next[1] - position[1]),
      f32(next[2] - position[2]),
    ];
    if (reachesRiftProjectileTarget(position, delta, target)) break;
    position = next;
    speed = f32(Math.min(speedCap, f32(speed + f32(acceleration * inputStep))));
    frames.push({
      age: startSeconds + age - startSeconds,
      position,
      velocity: direction.map((lane) => f32(lane * speed)),
    });
    if (age >= maximumLifetime) break;
  }
  const end = frames.at(-1)?.age;
  if (end === undefined || end === 0) return undefined;
  return {
    start: startSeconds,
    end: startSeconds + end,
    sample: makeRibbonSampler(frames, { ...emitter, end }),
  };
}

export async function readBuildScopedRiftTrails(
  resources: ReplayResources,
  replay: ArrayBuffer,
  signal: AbortSignal,
  {
    scene,
    heights,
  }: { scene: TerrainScene; heights: Float32Array | undefined },
) {
  const maokai = new Set(
    scene.participants
      .filter(({ championName }) => championName === "Maokai")
      .map(({ participantId }) => participantId),
  );
  const owners = new Set(
    scene.championModels?.bindings
      .filter(
        ({ participantId, skinId }) =>
          maokai.has(participantId) && skinId === 33,
      )
      .map(({ participantId }) => participantId),
  );
  if (owners.size === 0) return undefined;
  if (
    scene.identity.build !== format ||
    scene.navgrid === undefined ||
    heights === undefined
  )
    throw invalidPackage(
      "The Rift projectile resources require the verified navigation grid.",
    );
  const [prefixes, material] = await Promise.all([
    readPrefixes(resources, replay, signal, [...owners]),
    resources
      .read("rift-ribbon.json")
      .then((bytes) =>
        resourceSchema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        ),
      ),
  ]);
  const groundAt = createNavgridGroundHeight(
    scene.mapBounds,
    scene.navgrid,
    heights,
  );
  let previous = -1;
  const flights = prefixes.flatMap((prefix) => {
    const {
      launch,
      startSeconds,
      launchSequence,
      birthMaskSequences,
      packetBoundary,
    } = prefix;
    if (
      !owners.has(launch.sourceContext) ||
      startSeconds < previous ||
      packetBoundary.timeSeconds <= startSeconds ||
      packetBoundary.timeSeconds > scene.identity.durationMilliseconds / 1000 ||
      birthMaskSequences.some(
        (sequence) =>
          sequence <= launchSequence || sequence >= packetBoundary.sequence,
      )
    )
      throw invalidPackage(
        "The Rift projectile worker returned an invalid placement.",
      );
    previous = startSeconds;
    const flight = createFlight(prefix, groundAt);
    return flight === undefined ? [] : [flight];
  });
  const style = {
    texture: material.texture,
    palette: material.palette,
    blend: "src-alpha-one",
    alphaTest: true,
    depthTest: true,
    worldRibbon: true,
  } as const;
  return {
    texture: material.texture,
    palette: material.palette,
    sampleAt: (time: number) =>
      flights.flatMap(({ start, end, sample }) => {
        if (time < start || time >= end) return [];
        const { vertices, indices } = sample(time - start);
        return vertices === null || indices === null
          ? []
          : [{ ...style, vertices, indices }];
      }),
  };
}

export type RiftRibbonTrack = NonNullable<
  Awaited<ReturnType<typeof readBuildScopedRiftTrails>>
>;
