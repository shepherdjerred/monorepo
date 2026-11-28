import { z } from "zod";
import { compileOrdinalClip } from "./scout-terrain-animations.ts";
import {
  chaosTurretCollapsePaths,
  chaosTurretCollapseStage2End,
} from "./tools/research/native-terrain-turret-collapse-assets.mjs";

export const ChaosTurretCollapseSchema = z.strictObject({
  bindings: z.literal(chaosTurretCollapsePaths.bindings),
  clip: z.literal(chaosTurretCollapsePaths.clip),
  rig: z.literal(chaosTurretCollapsePaths.rig),
});

export async function loadRecordedTurretCollapse(
  binding: {
    url: string;
    collapse: z.infer<typeof ChaosTurretCollapseSchema>;
    settledRubble: { afterSeconds: number };
  },
  read: (resource: string) => Promise<ArrayBuffer>,
) {
  const { sampler } = await compileOrdinalClip(
    { ...binding.collapse, model: binding.url },
    read,
  );
  if (
    sampler.frames !== 58 ||
    sampler.fps !== 30 ||
    sampler.duration !== binding.settledRubble.afterSeconds
  )
    throw new Error("The authored turret collapse violates its clip clock.");

  const palettes = new Map<number, Float32Array>();
  return (context: number, elapsedSeconds: number) => {
    const palette = sampler.sample(elapsedSeconds, palettes.get(context));
    if (!palettes.has(context)) palettes.set(context, palette);
    return {
      collapsePhase: elapsedSeconds < chaosTurretCollapseStage2End ? 1 : 2,
      palette,
    };
  };
}
