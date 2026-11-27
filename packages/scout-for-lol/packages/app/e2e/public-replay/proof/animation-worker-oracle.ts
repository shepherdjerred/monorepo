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
  cues: z
    .array(
      z.object({
        ...timings,
        context: z.number().int().positive(),
        modelSha256: digest,
        rig: asset,
        clip: asset,
        bindings: asset,
      }),
    )
    .length(502),
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

export async function verifyDirectAnimationCues(
  oracleRoot: string,
  replaySha256: string,
  actual: z.infer<typeof workerAnimationCues>,
) {
  const bytes = await Bun.file(
    path.join(
      oracleRoot,
      "exact-8428-current-animation-batch",
      "scout-animation.json",
    ),
  ).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    "87991ae95a6510547938a691f22d4b34c982d9235542d459ba0fa6474b756dc5",
  );
  const { replaySha256: expectedReplay, cues } = oracle.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  expect(expectedReplay).toBe(replaySha256);
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
