import { sha256 } from "./structural-comparison.mjs";
import { animationHash } from "./latest-animation.mjs";

const f = Math.fround,
  finite = (v) => typeof v === "number" && Number.isFinite(f(v)),
  blocks = [
    [0x15d6a70, 0x15d6ac6],
    [0x1589050, 0x1589183],
    [0x158919b, 0x1589205],
    [0x15b5200, 0x15b5265],
    [0x15b08e0, 0x15b0981],
    [0x15bfb50, 0x15bfb60],
    [0x15bf960, 0x15bf980],
    [0x15af2ee, 0x15af315],
    [0x1595b1b, 0x1595b31],
    [0x15aeda2, 0x15aedaa],
    [0x15aedcb, 0x15aeddd],
    [0x158522a, 0x158525e],
    [0x15bfaf0, 0x15bfb30],
    [0x15bf940, 0x15bf950],
  ];

// Translation of the pinned atomic clock prefixes, not a complete animation
// controller. resourceFrames must come from the matching loaded-resource getter.
export function sampleNativeAtomicClock(clock, elapsed, delta = 0, rate = 1) {
  if (
    !clock ||
    !Number.isInteger(clock.resourceFrames) ||
    clock.resourceFrames < 1 ||
    clock.resourceFrames > 100000 ||
    ![
      clock.tickDuration,
      clock.resourceFps,
      clock.startFrame,
      clock.endFrame,
      elapsed,
      delta,
      rate,
    ].every(finite) ||
    clock.tickDuration <= 0 ||
    clock.resourceFps <= 0
  )
    throw Error("Invalid atomic clock input");
  const authoredStart = f(clock.startFrame),
    start = authoredStart >= 0 ? authoredStart : 0,
    // Native: getter count, integer decrement, float conversion, then -1.
    end =
      clock.endFrame < 0
        ? f(f(clock.resourceFrames - 1) - 1)
        : f(clock.endFrame),
    span = Math.trunc(f(f(end - start) + 1));
  if (span < 0 || span > 100000)
    throw Error("Unsupported atomic frame interval");
  const duration = f(f(span) * f(clock.tickDuration)),
    updatedElapsed = f(f(f(delta) * f(rate)) + f(elapsed)),
    frame =
      span === 0
        ? f(start + 0)
        : f(start + f(f(span) * f(updatedElapsed / duration)));
  if (![duration, updatedElapsed, frame].every(Number.isFinite))
    throw Error("Non-finite native atomic clock result");
  // The original pose path uses a direct division by tick duration; its
  // rounding differs from the event dispatcher's interval-normalized frame.
  const poseFrame = f(start + f(updatedElapsed / f(clock.tickDuration))),
    poseTime = f(poseFrame / f(clock.resourceFps));
  if (![poseFrame, poseTime].every(Number.isFinite))
    throw Error("Non-finite atomic pose clock");
  return { frame, duration, elapsed: updatedElapsed, poseFrame, poseTime };
}

export async function createLatestAnimationClock(profile, definitionBytes) {
  if ((await sha256(definitionBytes)) !== profile.animationClockSha256)
    throw Error("Animation clock package hash mismatch");
  const definition = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== definition.build ||
    profile.protocolDigest !== definition.protocol ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.decoderImageSha256 !== profile.decoderImageSha256 ||
    definition.defaults.tickDuration !== f(1 / 30) ||
    definition.defaults.startFrame !== 0 ||
    definition.defaults.endFrame !== -1 ||
    JSON.stringify(
      definition.sourceBlocks?.map((v) => [v.startRva, v.endRva]),
    ) !== JSON.stringify(blocks)
  )
    throw Error("Unsupported atomic clock package");
  return {
    async bind(graphFile, graphBytes, catalogBytes) {
      const source = definition.graphs[graphFile];
      if (
        !source ||
        (await sha256(graphBytes)) !== source.graphSha256 ||
        (await sha256(catalogBytes)) !== source.catalogSha256
      )
        throw Error("Animation clock graph/catalog mismatch");
      const clips = new Map();
      for (const [name, clip] of Object.entries(source.clips)) {
        const key = name.startsWith("{")
          ? name.toLowerCase()
          : animationHash(name);
        if (clips.has(key)) throw Error("Ambiguous atomic clock name");
        if (clip.status !== "prepared")
          throw Error(`Unprepared atomic clock ${name}`);
        const baseline = sampleNativeAtomicClock(clip.clock, 0);
        if (baseline.duration !== clip.duration)
          throw Error("Atomic duration differs from native preparation");
        clips.set(key, clip);
      }
      return {
        evaluate(name, elapsed, delta = 0, rate = 1) {
          const key = name.startsWith("{")
              ? name.toLowerCase()
              : animationHash(name),
            clip = clips.get(key);
          if (!clip) throw Error(`Atomic clock absent: ${name}`);
          return sampleNativeAtomicClock(clip.clock, elapsed, delta, rate);
        },
      };
    },
  };
}
