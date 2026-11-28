import type { ReplayResources } from "@scout-for-lol/replay/engine";
import { ReplayCapabilityError } from "@scout-for-lol/replay/types";
import { z } from "zod";
import type { TerrainScene } from "./scout-terrain-scene.ts";

const uint32 = z.number().int().nonnegative().max(0xffffffff);
const sennaGroundHitResourceKey = 0x6bb08197;
const WorkerResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(false), message: z.string().nonempty() }),
  z.strictObject({
    ok: z.literal(true),
    entries: z.array(
      z.object({
        timeSeconds: z.number().nonnegative(),
        resourceKey: z.literal(sennaGroundHitResourceKey),
        handle: uint32,
        owner: uint32,
        parent: uint32,
        context: uint32,
        flags: z.number().int().nonnegative().nullable(),
      }),
    ),
  }),
]);

function invalidPackage(message: string) {
  return new ReplayCapabilityError("invalid-package", message);
}

async function readCombatAudioCreations(
  resources: ReplayResources,
  replay: ArrayBuffer,
  signal: AbortSignal,
) {
  const pages = (await resources.read("rift-combat-audio-pages.bin")).slice()
    .buffer;
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
      worker.postMessage({ replay: replayCopy, pages }, [replayCopy, pages]);
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

export async function readBuildScopedCombatCueTimes(
  resources: ReplayResources,
  replay: ArrayBuffer,
  signal: AbortSignal,
  scene: TerrainScene,
) {
  if (scene.championModels === undefined)
    throw invalidPackage("Rift combat audio requires verified opening skins.");
  const senna = new Set(
    scene.participants
      .filter(({ championName }) => championName === "Senna")
      .map(({ participantId }) => participantId),
  );
  // The reviewed skin 18 uses the Skin16 ground-hit event and its sole media.
  const owners = new Set(
    scene.championModels.bindings
      .filter(
        ({ participantId, skinId }) =>
          senna.has(participantId) && skinId === 18,
      )
      .map(({ participantId }) => participantId),
  );
  if (owners.size === 0) return [];

  const duration = scene.identity.durationMilliseconds / 1000;
  const entries = await readCombatAudioCreations(resources, replay, signal);
  const handles = new Set<number>();
  const times: number[] = [];
  for (const {
    owner,
    handle,
    parent,
    context,
    flags,
    timeSeconds,
  } of entries) {
    if (!owners.has(owner) || parent !== 0 || context !== 0 || flags !== 32)
      continue;
    if (
      handle === 0 ||
      handles.has(handle) ||
      timeSeconds <= 0 ||
      timeSeconds >= duration ||
      timeSeconds < (times.at(-1) ?? 0)
    )
      throw invalidPackage(
        "The Rift combat audio creation order or clock is invalid.",
      );
    handles.add(handle);
    times.push(timeSeconds);
  }
  return times;
}
