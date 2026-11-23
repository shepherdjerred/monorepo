import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { z } from "zod";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import type { readRecordedReplay } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";

const meshRanges = z.object({
  meshes: z.array(
    z.object({
      controller: z.number().int().nonnegative(),
      indexCount: z.number().int().positive(),
      submeshes: z.array(
        z.object({
          start: z.number(),
          count: z.number(),
          material: z.string(),
        }),
      ),
    }),
  ),
});

export async function readRecordedTerrainRanges(
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  if (fixture.terrainVisibility === undefined) return;
  const tracks = new Map(
    fixture.terrainVisibility.tracks.map(({ controllerId, points }) => [
      controllerId,
      points,
    ]),
  );
  const materialNames = new Set(
    fixture.terrainMaterials?.bindings.map(({ material }) => material),
  );
  const blendedNames = new Set(
    fixture.terrainMaterials?.bindings
      .filter(({ sourceAlphaBlend }) => sourceAlphaBlend)
      .map(({ material }) => material),
  );
  const { meshes } = meshRanges.parse(
    await Bun.file(path.join(fixture.root, "map.json")).json(),
  );
  let offset = 0;
  const ranges = meshes.flatMap((mesh) => {
    const firstIndex = offset;
    offset += mesh.indexCount;
    return mesh.submeshes
      .filter(({ material }) => materialNames.has(material))
      .map(({ start, count, material }) => ({
        byteOffset: (firstIndex + start) * 4,
        count,
        controller: mesh.controller,
        blend: blendedNames.has(material),
      }));
  });
  return (time: number) =>
    ranges.filter(({ controller }) => {
      const points = tracks.get(controller);
      if (points === undefined) return true;
      const active = points.findLast(([at]) => at <= time);
      if (active === undefined)
        throw new Error("Terrain coverage has no opening controller state.");
      return active[1];
    });
}

type TerrainRanges = NonNullable<
  Awaited<ReturnType<typeof readRecordedTerrainRanges>>
>;
type TerrainDraw = Awaited<ReturnType<typeof readRecordedDraw>>;

export function verifyOpeningTerrain(
  opening: TerrainDraw,
  sourceAlphaBlendMaterials: string[],
  rangesAt: TerrainRanges | undefined,
) {
  expect(opening.textures).toBeGreaterThan(0);
  expect(opening.texturedIndices).toBeGreaterThan(0);
  expect(sourceAlphaBlendMaterials).toEqual(
    Bun.env["SCOUT_REPLAY_E2E_EXPECT_GROMP_DECALS"] === "1" ||
      sourceAlphaBlendMaterials.length > 0
      ? ["Earth_Order_GrompDecal_A_MAT", "Earth_Chaos_GrompDecal_A_MAT"]
      : [],
  );
  if (rangesAt !== undefined) {
    verifyTerrainRanges(opening, rangesAt(0));
    return;
  }
  expect(opening.terrainBlendDraws).toEqual(
    sourceAlphaBlendMaterials.map(() => ({
      indexCount: 6,
      depthWrites: false,
      factors: [770, 771, 770, 771],
    })),
  );
}

export function verifyLateTerrain(
  lateMatch: TerrainDraw,
  opening: TerrainDraw,
  lateTime: number,
  rangesAt: TerrainRanges | undefined,
) {
  if (rangesAt !== undefined) {
    verifyTerrainRanges(lateMatch, rangesAt(lateTime));
    return;
  }
  expect(lateMatch.texturedIndices).toBe(opening.texturedIndices);
  expect(lateMatch.terrainBlendDraws).toEqual(opening.terrainBlendDraws);
}

function verifyTerrainRanges(
  draw: TerrainDraw,
  expected: ReturnType<TerrainRanges>,
) {
  expect(draw.terrainDrawOffsets.toSorted((a, b) => a - b)).toEqual(
    expected.map(({ byteOffset }) => byteOffset),
  );
  expect(draw.texturedIndices).toBe(
    expected.reduce((sum, { count }) => sum + count, 0),
  );
  expect(draw.terrainBlendDraws).toEqual(
    expected
      .filter(({ blend }) => blend)
      .map(({ count }) => ({
        indexCount: count,
        depthWrites: false,
        factors: [770, 771, 770, 771],
      })),
  );
}

export async function verifyRecordedTerrainTransitions(
  page: Page,
  rangesAt: TerrainRanges,
  testInfo: TestInfo,
  infernal: boolean,
) {
  if (infernal) {
    await verifyRecordedTerrainTransition(page, rangesAt, testInfo, {
      name: "infernal",
      before: 762,
      after: 762.1,
      original: [0x4a_ef_d2_82, 0xa8_95_1f_f3],
      replacement: 0xd1_a1_73_99,
    });
  }
  await verifyRecordedTerrainTransition(page, rangesAt, testInfo, {
    name: "baron",
    before: 1198.3,
    after: 1198.4,
    original: [0xf4_96_86_31],
    replacement: 0x68_fe_76_44,
  });
}

async function verifyRecordedTerrainTransition(
  page: Page,
  rangesAt: TerrainRanges,
  testInfo: TestInfo,
  transition: {
    name: string;
    before: number;
    after: number;
    original: number[];
    replacement: number;
  },
) {
  const { name, before, after, original, replacement } = transition;
  const beforeRanges = rangesAt(before);
  const afterRanges = rangesAt(after);
  const beforeControllers = new Set(
    beforeRanges.map(({ controller }) => controller),
  );
  const afterControllers = new Set(
    afterRanges.map(({ controller }) => controller),
  );
  for (const controller of original) {
    expect(beforeControllers.has(controller)).toBe(true);
    expect(afterControllers.has(controller)).toBe(false);
  }
  expect(beforeControllers.has(replacement)).toBe(false);
  expect(afterControllers.has(replacement)).toBe(true);
  const canvas = page.getByLabel("League of Legends replay scene");
  await seek(page, before);
  verifyTerrainRanges(await readRecordedDraw(page), beforeRanges);
  await canvas.screenshot({
    path: testInfo.outputPath(`${name}-terrain-before.png`),
  });
  await seek(page, after);
  verifyTerrainRanges(await readRecordedDraw(page), afterRanges);
  await canvas.screenshot({
    path: testInfo.outputPath(`${name}-terrain-after.png`),
  });
  await seek(page, before);
  verifyTerrainRanges(await readRecordedDraw(page), beforeRanges);
}
