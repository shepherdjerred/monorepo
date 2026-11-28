import type { ReplayResources } from "@scout-for-lol/replay/engine";
import { ReplayCapabilityError } from "@scout-for-lol/replay/types";
import { z } from "zod";
import {
  riftBillboardSources,
  riftGroundGlowSource,
  sennaGroundHitResourceKey,
  type RiftBillboardSource,
} from "./scout-rift-billboard-sources.ts";
import type { TerrainScene } from "./scout-terrain-scene.ts";

const uint32 = z.number().int().nonnegative().max(0xffffffff);
const billboardSourcesByKey = new Map<number, RiftBillboardSource>(
  [...Object.values(riftBillboardSources), riftGroundGlowSource].map(
    (source) => [source.resourceKey, source],
  ),
);
const replayTime = z.number().nonnegative();
const sequence = z.number().int().nonnegative();
const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const stopEnvelope = z.strictObject({ timeSeconds: replayTime, sequence });
const stopRequest = z.discriminatedUnion("route", [
  stopEnvelope.extend({
    flags: z.literal(52),
    route: z.literal("direct-stop"),
  }),
  stopEnvelope.extend({
    flags: z.literal(60),
    route: z.literal("alternate-stop"),
  }),
]);
const CreationSchema = z.strictObject({
  timeSeconds: replayTime,
  sequence,
  resourceKey: uint32,
  handle: uint32,
  owner: uint32,
  parent: uint32,
  context: uint32,
  flags: uint32,
  positions: z.tuple([vector3, vector3, vector3]),
  scaleRate: z.tuple([z.number(), z.number()]),
  stops: z.array(stopRequest),
  handleCount: z.number().int().nonnegative(),
});
export type RiftCombatVisualEntry = z.infer<typeof CreationSchema>;

const WorkerResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(false), message: z.string().nonempty() }),
  z.strictObject({
    ok: z.literal(true),
    entries: z.array(CreationSchema),
  }),
]);

function invalidPackage(message: string) {
  return new ReplayCapabilityError("invalid-package", message);
}

async function readCombatCreations(
  resources: ReplayResources,
  replay: ArrayBuffer,
  signal: AbortSignal,
  visualResourceKeys?: number[],
) {
  const [pages, stopMaps] = await Promise.all([
    resources
      .read("rift-combat-audio-pages.bin")
      .then((bytes) => bytes.slice().buffer),
    visualResourceKeys !== undefined
      ? resources
          .read("replay-motion-decoder.bin")
          .then((bytes) => bytes.slice().buffer)
      : undefined,
  ]);
  signal.throwIfAborted();
  const worker = await resources.worker("rift-combat-audio-worker.mjs");
  let abort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const message = await new Promise<unknown>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      worker.addEventListener(
        "message",
        ({ data }: MessageEvent<unknown>) => resolve(data),
        { once: true },
      );
      worker.addEventListener(
        "error",
        () => reject(invalidPackage("The Rift combat audio worker failed.")),
        { once: true },
      );
      worker.addEventListener(
        "messageerror",
        () =>
          reject(
            invalidPackage(
              "The Rift combat audio worker returned invalid data.",
            ),
          ),
        { once: true },
      );
      const replayCopy = replay.slice(0);
      const transfer = [replayCopy, pages];
      if (stopMaps !== undefined) transfer.push(stopMaps);
      worker.postMessage(
        {
          replay: replayCopy,
          pages,
          stopMaps,
          visualResourceKeys,
        },
        transfer,
      );
    });
    signal.throwIfAborted();
    const result = WorkerResultSchema.safeParse(message);
    if (!result.success)
      throw invalidPackage(
        "The Rift combat audio worker returned invalid data.",
      );
    if (!result.data.ok) throw invalidPackage(result.data.message);
    return result.data.entries;
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    worker.terminate();
  }
}

export async function readBuildScopedCombatEffects(
  resources: ReplayResources,
  replay: ArrayBuffer,
  signal: AbortSignal,
  motionScene: Promise<TerrainScene>,
  {
    audio,
    visual,
    worldQuads,
  }: { audio: boolean; visual: boolean; worldQuads: boolean },
) {
  const cueTimes: number[] = [];
  const visualEntries: RiftCombatVisualEntry[] = [];
  if (!audio && !visual) return { cueTimes, visualEntries };
  // The full creation census is independent of motion decoding. Validate
  // source ownership only after the replay's opening roster is available.
  const visualKeys = Object.values(riftBillboardSources).map(
    ({ resourceKey }) => Number(resourceKey),
  );
  if (worldQuads) visualKeys.push(riftGroundGlowSource.resourceKey);
  const [scene, visualCreations] = await Promise.all([
    motionScene,
    visual
      ? readCombatCreations(resources, replay, signal, visualKeys)
      : undefined,
  ]);
  if (scene.championModels === undefined)
    throw invalidPackage("Rift combat effects require verified opening skins.");
  const champions = new Map(
    scene.participants.map(({ participantId, championName }) => [
      participantId,
      championName,
    ]),
  );
  const skins = new Map(
    scene.championModels.bindings.map(({ participantId, skinId }) => [
      participantId,
      skinId,
    ]),
  );
  const sennaSource = riftBillboardSources["senna-w-ground-impact-flare"];
  if (
    visualCreations === undefined &&
    !scene.participants.some(
      ({ participantId, championName }) =>
        championName === sennaSource.champion &&
        skins.get(participantId) === sennaSource.skinId,
    )
  )
    return { cueTimes, visualEntries };

  const duration = scene.identity.durationMilliseconds / 1000;
  const entries =
    visualCreations ?? (await readCombatCreations(resources, replay, signal));
  const cueHandles = new Set<number>();
  let previousTime = 0;
  for (const entry of entries) {
    const { resourceKey, owner, handle, parent, context, flags, timeSeconds } =
      entry;
    const source = billboardSourcesByKey.get(resourceKey);
    if (
      source === undefined ||
      champions.get(owner) !== source.champion ||
      skins.get(owner) !== source.skinId ||
      parent !== 0 ||
      context !== 0 ||
      flags !== 0x20
    )
      continue;
    const hasAudio = audio && resourceKey === sennaGroundHitResourceKey;
    const validPlacement =
      handle !== 0 && timeSeconds > 0 && timeSeconds < duration;
    if (
      timeSeconds < previousTime ||
      (hasAudio && (!validPlacement || cueHandles.has(handle)))
    )
      throw invalidPackage(
        "The Rift combat effect creation order or clock is invalid.",
      );
    previousTime = timeSeconds;
    if (hasAudio) {
      cueHandles.add(handle);
      cueTimes.push(timeSeconds);
    }
    if (visual && validPlacement) visualEntries.push(entry);
  }
  return { cueTimes, visualEntries };
}
