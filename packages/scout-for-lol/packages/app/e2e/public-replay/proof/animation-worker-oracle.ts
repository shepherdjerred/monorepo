import { expect } from "@playwright/test";
import path from "node:path";
import { z } from "zod";

const digest = z.string().regex(/^[a-f\d]{64}$/u);
const timings = {
  timeSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  rate: z.number().positive(),
};
const asset = z.object({ sha256: digest });
const oracle = z.object({
  schema: z.literal(1),
  kind: z.literal("recorded-champion-animation-cues"),
  build: z.literal("16.23.841.8428"),
  protocol: z.literal("8bbfcd5af2bc92db"),
  replaySha256: digest,
  cues: z.array(
    z.object({
      ...timings,
      context: z.number().int().positive(),
      modelSha256: digest,
      rig: asset,
      clip: asset,
      bindings: asset,
    }),
  ),
});

export const workerAnimationCues = z.array(
  z.strictObject({
    participantId: z.number().int().positive(),
    model: z.string(),
    ...timings,
    rig: z.string(),
    clip: z.string(),
    bindings: z.string(),
  }),
);

export const AnimationOmissionsSchema = z.strictObject({
  missingModel: z.array(z.number().int().positive()),
});

export async function verifyRecordedAnimationResponse(
  actual: {
    animationCues?: z.infer<typeof workerAnimationCues> | undefined;
    championAnimationOmissions?:
      z.infer<typeof AnimationOmissionsSchema> | undefined;
  },
  {
    descriptor,
    directChampionAnimation,
    animationModelCount,
    championAnimationCueCount,
  }: {
    descriptor: { sha256: string };
    directChampionAnimation: boolean;
    animationModelCount: number | undefined;
    championAnimationCueCount: number;
  },
  oracleRoot: string,
) {
  const expanded = animationModelCount === 8;
  const missingModel = expanded
    ? [1_073_742_165, 1_073_742_170]
    : [
        1_073_742_161, 1_073_742_162, 1_073_742_165, 1_073_742_166,
        1_073_742_170,
      ];
  expect(actual.championAnimationOmissions).toEqual(
    animationModelCount === undefined ? undefined : { missingModel },
  );
  if (directChampionAnimation) {
    if (actual.animationCues === undefined)
      throw new Error(
        "Direct worker response is missing champion animation cues.",
      );
    await verifyDirectAnimationCues(
      oracleRoot,
      descriptor.sha256,
      actual.animationCues,
      expanded,
    );
    return actual.animationCues.length;
  }
  expect(actual.animationCues).toBeUndefined();
  return championAnimationCueCount;
}

async function verifyDirectAnimationCues(
  oracleRoot: string,
  replaySha256: string,
  actual: z.infer<typeof workerAnimationCues>,
  expanded: boolean,
) {
  const bytes = await Bun.file(
    path.join(
      oracleRoot,
      expanded
        ? "scout-8428-direct-no-blend-color-corrected"
        : "exact-8428-current-animation-batch",
      "scout-animation.json",
    ),
  ).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    expanded
      ? "df3adc117471e1b39d357701341219aabc96baa9f3521cf9467ab7c77c930caf"
      : "87991ae95a6510547938a691f22d4b34c982d9235542d459ba0fa6474b756dc5",
  );
  const { replaySha256: expectedReplay, cues } = oracle.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  expect(expectedReplay).toBe(replaySha256);
  expect(cues).toHaveLength(expanded ? 1020 : 502);
  expect(actual).toEqual(
    cues.map((cue) => ({
      participantId: cue.context,
      model: `/champion-models/${cue.modelSha256}.glb`,
      timeSeconds: cue.timeSeconds,
      endSeconds: cue.endSeconds,
      rate: cue.rate,
      rig: `/champion-animations/${cue.rig.sha256}.skl`,
      clip: `/champion-animations/${cue.clip.sha256}.clip`,
      bindings: `/champion-animations/${cue.bindings.sha256}.json`,
    })),
  );
}
