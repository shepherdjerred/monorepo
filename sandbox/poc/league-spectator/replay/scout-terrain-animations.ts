import { Matrix4, Quaternion, Vector3 } from "/three.core.js";
import { z } from "zod";
import { readOriginalRigOrdinalSource } from "./tools/ordinal-model-layout.mjs";
import { createOrdinalClipSampler } from "./tools/research/native-terrain-animation.mjs";
import { latestAt } from "./tools/research/native-terrain-motion-sample.mjs";

export const ChampionAnimationCuesSchema = z
  .array(
    z.strictObject({
      participantId: z.number().int().positive(),
      timeSeconds: z.number().nonnegative(),
      endSeconds: z.number().positive(),
      rate: z.number().positive(),
      model: z.string().regex(/^\/champion-models\/[a-f0-9]{64}\.glb$/),
      bindings: z.string().regex(/^\/champion-animations\/[a-f0-9]{64}\.json$/),
      clip: z.string().regex(/^\/champion-animations\/[a-f0-9]{64}\.clip$/),
      rig: z.string().regex(/^\/champion-animations\/[a-f0-9]{64}\.skl$/),
    }),
  )
  .nonempty();

type Cue = z.infer<typeof ChampionAnimationCuesSchema>[number];
type ClipSampler = ReturnType<typeof createOrdinalClipSampler>;

function compileClip(
  cue: Cue,
  read: (resource: string) => Promise<ArrayBuffer>,
) {
  return Promise.all([
    read(cue.model),
    read(cue.rig),
    read(cue.clip),
    read(cue.bindings),
  ]).then(([model, rig, clip, bindings]) => {
    const sampler = createOrdinalClipSampler(
      { Matrix4, Quaternion, Vector3 },
      model,
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bindings)),
      readOriginalRigOrdinalSource(new Uint8Array(rig)),
      clip,
    );
    return { sampler, palette: new Float32Array(sampler.paletteSize * 16) };
  });
}

export async function loadRecordedChampionAnimations(
  cues: z.infer<typeof ChampionAnimationCuesSchema>,
  durationSeconds: number,
  read: (resource: string) => Promise<ArrayBuffer>,
) {
  const timelines = new Map<number, Cue[]>();
  for (const cue of cues) {
    const timeline = timelines.get(cue.participantId) ?? [];
    if (
      cue.timeSeconds < (timeline.at(-1)?.endSeconds ?? 0) ||
      cue.endSeconds > durationSeconds ||
      cue.endSeconds <= cue.timeSeconds
    )
      throw new Error(
        "Champion animation cues have an invalid replay interval.",
      );
    timeline.push(cue);
    timelines.set(cue.participantId, timeline);
  }
  const assets = new Map<string, Promise<ArrayBuffer>>();
  const readOnce = (path: string) => {
    const pending = assets.get(path) ?? read(path);
    assets.set(path, pending);
    return pending;
  };
  const clips = new Map<string, ReturnType<typeof compileClip>>();
  const compileCue = async (cue: Cue) => {
    const key = [
      cue.participantId,
      cue.model,
      cue.rig,
      cue.clip,
      cue.bindings,
    ].join("|");
    const compiled = clips.get(key) ?? compileClip(cue, readOnce);
    clips.set(key, compiled);
    const { sampler, palette } = await compiled;
    if (cue.endSeconds > cue.timeSeconds + sampler.duration / cue.rate + 1e-6)
      throw new Error("Champion animation cue outlasts its authored clip.");
    return { ...cue, sampler, palette };
  };
  const animations = new Map(
    await Promise.all(
      [...timelines].map(
        async ([participantId, timeline]) =>
          [participantId, await Promise.all(timeline.map(compileCue))] as const,
      ),
    ),
  );
  const active = new Map<number, Float32Array>();
  return (
    timeSeconds: number,
    markers: readonly { participantId: number }[],
  ) => {
    active.clear();
    for (const { participantId } of markers) {
      const timeline = animations.get(participantId);
      if (timeline === undefined) continue;
      const cue:
        (Cue & { sampler: ClipSampler; palette: Float32Array }) | undefined =
        latestAt(timeline, timeSeconds);
      if (cue === undefined || timeSeconds >= cue.endSeconds) continue;
      active.set(
        cue.participantId,
        cue.sampler.sample(
          (timeSeconds - cue.timeSeconds) * cue.rate,
          cue.palette,
        ),
      );
    }
    return active;
  };
}
