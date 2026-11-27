import { expect, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import { readDirectWorkerReply } from "./proof/motion-worker-capture.ts";
import type { readRecordedReplay } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";
import { centerMinimapOn, drawsNear } from "./recorded-world-assertions.ts";

export const recordedInhibitorReturnWitnesses = [
  {
    position: [13_599.171, 11_319.917],
    indices: 4452,
    returnedAt: 1920.73898046875,
  },
  {
    position: [11_593.575, 11_669.565],
    indices: 4452,
    returnedAt: 2005.531666015625,
  },
  {
    position: [3210.616, 3217.527],
    indices: 6675,
    returnedAt: 2362.538064453125,
  },
] as const;

const InhibitorModelsSchema = z.strictObject({
  instances: z
    .array(
      z.strictObject({
        context: z.number().int().positive(),
        participantId: z.number().int().positive(),
        position: z.tuple([z.number(), z.number(), z.number()]),
        basis: z.array(z.number()).length(9),
        teamId: z.union([z.literal(100), z.literal(200)]),
        destroyedAtSeconds: z.number().positive().nullable(),
        inactiveRanges: z.array(
          z.tuple([z.number().positive(), z.number().positive().nullable()]),
        ),
      }),
    )
    .length(6),
});
const InhibitorLossesSchema = z
  .array(
    z.strictObject({
      timeSeconds: z.number().positive(),
    }),
  )
  .length(5);
const InhibitorOracleSchema = z.object({
  replaySha256: z.string(),
  inhibitorModels: InhibitorModelsSchema,
  inhibitorLosses: InhibitorLossesSchema,
});

async function readInhibitorInstances(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  const ready = z
    .object({
      inhibitorModels: InhibitorModelsSchema.optional(),
      inhibitorLosses: InhibitorLossesSchema.optional(),
    })
    .optional()
    .parse(
      await readDirectWorkerReply(page, ["inhibitorModels", "inhibitorLosses"]),
    );
  if (!fixture.directInhibitors) {
    expect(ready?.inhibitorModels).toBeUndefined();
    expect(ready?.inhibitorLosses).toBeUndefined();
    return fixture.inhibitorInstances;
  }
  const oracleRoot = Bun.env["SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY"];
  if (oracleRoot === undefined || oracleRoot === "")
    throw new Error(
      "Set SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY for inhibitor verification.",
    );
  const bytes = await Bun.file(
    path.join(oracleRoot, "scout-8428-v39-inhibitor-oracle.json"),
  ).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    "0e0da46914def5b659516f952bc060e8fa60dd8975218bf407743e90d986d801",
  );
  const oracle = InhibitorOracleSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  expect(oracle.replaySha256).toBe(fixture.descriptor.sha256);
  expect(ready?.inhibitorModels).toEqual(oracle.inhibitorModels);
  expect(ready?.inhibitorLosses).toEqual(oracle.inhibitorLosses);
  return ready?.inhibitorModels?.instances;
}

export async function verifyRecordedInhibitorReturns(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
  testInfo: TestInfo,
) {
  const instances = await readInhibitorInstances(page, fixture);
  if (
    fixture.descriptor.gameBuild !== "16.23.841.8428" ||
    instances?.some(({ inactiveRanges }) => inactiveRanges !== undefined) !==
      true
  )
    return;

  const minimap = page.getByRole("button", { name: "Replay minimap" });
  const canvas = page.getByLabel("League of Legends replay scene");
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const overview = page.getByRole("button", { name: "Map overview" });
  for (const {
    position,
    indices,
    returnedAt,
  } of recordedInhibitorReturnWitnesses) {
    const [x, depth] = position;
    const instance = instances.find(
      ({ position: [px, , pz] }) => Math.hypot(x - px, depth - pz) < 0.001,
    );
    // The original opcode 947 clocks are exact. The slider steps by 0.1 s.
    const before = Math.floor(returnedAt * 10) / 10;
    const after = Math.ceil(returnedAt * 10) / 10;
    expect(
      instance?.inactiveRanges?.some(
        ([loss, end]) => loss <= before && end === returnedAt,
      ),
    ).toBe(true);

    await seek(page, before);
    await centerMinimapOn(minimap, position);
    await zoomIn.click();
    await zoomIn.click();
    for (const { seconds, visible, frame } of [
      { seconds: before, visible: false, frame: "before" },
      { seconds: after, visible: true, frame: "after" },
      { seconds: before, visible: false, frame: "rewound" },
    ] as const) {
      await seek(page, seconds);
      await expect.poll(() => drawsNear(page, indices, position)).toBe(visible);
      await canvas.screenshot({
        path: testInfo.outputPath(
          `recorded-inhibitor-return-${Math.floor(returnedAt).toString()}-${frame}.png`,
        ),
      });
    }
    await overview.click();
  }
}
