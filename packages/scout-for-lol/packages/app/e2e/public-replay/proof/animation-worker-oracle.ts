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

const currentAnimationOracles = new Map([
  [
    5,
    {
      directory: "exact-8428-current-animation-batch",
      sha256:
        "87991ae95a6510547938a691f22d4b34c982d9235542d459ba0fa6474b756dc5",
      count: 502,
      missingModel: [
        1_073_742_161, 1_073_742_162, 1_073_742_165, 1_073_742_166,
        1_073_742_170,
      ],
    },
  ],
  [
    8,
    {
      directory: "scout-8428-direct-no-blend-color-corrected",
      sha256:
        "df3adc117471e1b39d357701341219aabc96baa9f3521cf9467ab7c77c930caf",
      count: 1020,
      missingModel: [1_073_742_165, 1_073_742_170],
    },
  ],
  [
    9,
    {
      directory: "scout-8428-senna-direct-animations",
      sha256:
        "b921f65cd77e92cb4db4ffd915608d8b73a49a691938282ed0c93c194a1fc287",
      count: 1031,
      missingModel: [1_073_742_170],
    },
  ],
]);

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
  const expected = currentAnimationOracles.get(animationModelCount ?? 5);
  if (expected === undefined)
    throw new Error("Missing oracle for the reviewed champion models.");
  expect(actual.championAnimationOmissions).toEqual(
    animationModelCount === undefined
      ? undefined
      : { missingModel: expected.missingModel },
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
      expected,
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
  expected: { directory: string; sha256: string; count: number },
) {
  const bytes = await Bun.file(
    path.join(oracleRoot, expected.directory, "scout-animation.json"),
  ).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    expected.sha256,
  );
  const { replaySha256: expectedReplay, cues } = oracle.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  expect(expectedReplay).toBe(replaySha256);
  expect(cues).toHaveLength(expected.count);
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
