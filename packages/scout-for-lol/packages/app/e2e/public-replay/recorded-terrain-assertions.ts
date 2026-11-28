import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { z } from "zod";
import type { RecordedTerrainVisibilitySchema } from "./proof/terrain-visibility-schema.ts";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import type { readRecordedReplay } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";

const meshRanges = z.object({
  meshes: z.array(
    z.object({
      controller: z.number().int().nonnegative(),
      flags: z.number().int().nonnegative().optional(),
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

type TerrainTracks = z.infer<typeof RecordedTerrainVisibilitySchema>["tracks"];

export function expectedRecordedTerrainTracks(
  mapDigest: string,
  tracks: TerrainTracks,
) {
  const combined =
    mapDigest ===
    "e5f69629e7a28a2ede5945cfb944f3558758953559a22c3c70ae82f97365b0bb";
  const mountain =
    combined ||
    mapDigest ===
      "5b3ed6a403893e7c4f38aab225aeadb96c625283956ffd010d649de9b80a3ccc";
  const variantTracks: TerrainTracks = [];
  // Authored default plus pinned ordinary write to name hash 215400aa.
  if (mountain)
    variantTracks.push({
      controllerId: 402_973_412,
      points: [
        [0, false],
        [883.34115234375, true],
      ],
    });
  // The authored Infernal cohort stays hidden during this Mountain replay.
  if (combined)
    variantTracks.push({ controllerId: 3_517_019_033, points: [[0, false]] });
  return [...tracks, ...variantTracks].sort(
    (a, b) => a.controllerId - b.controllerId,
  );
}

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
  const omitted = new Set(fixture.terrainVisibility.omittedMeshControllerIds);
  const windows = fixture.terrainVisibility.unresolvedWindows ?? [];
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
  const mountainOffsets: number[] = [];
  const infernalOffsets: number[] = [];
  const ranges = meshes.flatMap((mesh) => {
    const firstIndex = offset;
    offset += mesh.indexCount;
    if (
      mesh.flags === 4 &&
      [0x18_04_e2_e4, 0x48_10_62_71].includes(mesh.controller)
    ) {
      mountainOffsets.push(
        ...mesh.submeshes.map(({ start }) => (firstIndex + start) * 4),
      );
    }
    if (mesh.flags === 2 && mesh.controller === 0xd1_a1_73_99) {
      infernalOffsets.push(
        ...mesh.submeshes.map(({ start }) => (firstIndex + start) * 4),
      );
    }
    return mesh.submeshes
      .filter(({ material }) => materialNames.has(material))
      .map(({ start, count, material }) => ({
        byteOffset: (firstIndex + start) * 4,
        count,
        controller: mesh.controller,
        blend: blendedNames.has(material),
      }));
  });
  const rangesAt = (time: number) =>
    ranges.filter(({ controller }) => {
      if (omitted.has(controller)) return false;
      if (
        windows.some(
          ({ controllerId, startSeconds, endSeconds }) =>
            controllerId === controller &&
            time >= startSeconds &&
            time < endSeconds,
        )
      )
        return false;
      const points = tracks.get(controller);
      if (points === undefined) return true;
      const active = points.findLast(([at]) => at <= time);
      if (active === undefined)
        throw new Error("Terrain coverage has no opening controller state.");
      return active[1];
    });
  return Object.assign(rangesAt, { mountainOffsets, infernalOffsets });
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
  if (rangesAt !== undefined && rangesAt.mountainOffsets.length > 0) {
    const mountainDecals = [
      "Earth_Chaos_KrugDecal_A_MAT",
      "Earth_Order_KrugDecal_A_MAT",
      "Earth_Order_RaptorDecal_A_MAT",
    ];
    if (rangesAt.infernalOffsets.length > 0) {
      expect(rangesAt.infernalOffsets).toHaveLength(3);
      mountainDecals.push(
        "Earth_Chaos_GrompDecal_A_MAT",
        "Earth_Order_GrompDecal_A_MAT",
      );
    }
    expect(sourceAlphaBlendMaterials.toSorted()).toEqual(
      mountainDecals.toSorted(),
    );
  } else {
    expect(sourceAlphaBlendMaterials).toEqual(
      Bun.env["SCOUT_REPLAY_E2E_EXPECT_GROMP_DECALS"] === "1" ||
        sourceAlphaBlendMaterials.length > 0
        ? ["Earth_Order_GrompDecal_A_MAT", "Earth_Chaos_GrompDecal_A_MAT"]
        : [],
    );
  }
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
  rangesAt: TerrainRanges | undefined,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
  testInfo: TestInfo,
) {
  if (rangesAt === undefined || fixture.terrainVisibility === undefined) return;
  // Keep the reviewed timing and replacement-geometry assertions for the
  // reference match. Held-out matches use the transition times in their tracks.
  if (
    fixture.descriptor.sha256 !==
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668"
  ) {
    const tenths = new Set(
      [
        ...fixture.terrainVisibility.tracks.flatMap(({ points }) =>
          points.slice(1).map(([at]) => at),
        ),
        ...(fixture.terrainVisibility.unresolvedWindows ?? []).flatMap(
          ({ startSeconds, endSeconds }) => [startSeconds, endSeconds],
        ),
      ].map((at) => Math.ceil(at * 10)),
    );
    for (const at of [...tenths].sort((left, right) => left - right)) {
      await verifyTransitionDraws(page, rangesAt, testInfo, {
        name: `terrain-transition-${String(at)}`,
        before: (at - 1) / 10,
        after: at / 10,
      });
    }
    await verifyMountainReplacementDraws(page, rangesAt, testInfo);
    return;
  }
  if (Bun.env["SCOUT_REPLAY_E2E_EXPECT_INFERNAL_TERRAIN"] === "1") {
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

async function verifyMountainReplacementDraws(
  page: Page,
  rangesAt: TerrainRanges,
  testInfo: TestInfo,
) {
  const { mountainOffsets } = rangesAt;
  if (mountainOffsets.length === 0) return;
  expect(mountainOffsets).toHaveLength(12);
  const activeMountainOffsets = (time: number) => {
    const submitted = new Set(
      rangesAt(time).map(({ byteOffset }) => byteOffset),
    );
    return mountainOffsets.filter((offset) => submitted.has(offset));
  };
  expect(activeMountainOffsets(883.3)).toEqual([]);
  expect(activeMountainOffsets(900.3)).toEqual(mountainOffsets);
  // The overview screenshots are captured by the regular transition and late
  // draw assertions. Check actual fragment coverage in the former interior gap.
  for (const name of [
    "terrain-transition-9003-terrain-after",
    "late-match-overview",
  ]) {
    const bytes = await Bun.file(testInfo.outputPath(`${name}.png`)).bytes();
    const covered = await page.evaluate(async (png) => {
      const frame = new globalThis.Image();
      frame.src = `data:image/png;base64,${png}`;
      await frame.decode();
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("Cannot inspect the replay frame.");
      context.drawImage(frame, 0, 0);
      const sky = context.getImageData(0, 0, 1, 1).data;
      const x = Math.round((520 * frame.width) / 1214);
      const y = Math.round((448 * frame.height) / 683);
      const pixels = context.getImageData(x - 2, y - 2, 5, 5).data;
      let terrainPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const rgb = pixels.slice(i, i + 3);
        if (
          rgb.some((value, channel) => value !== sky[channel]) &&
          rgb.some((value) => value !== 0)
        )
          terrainPixels += 1;
      }
      return terrainPixels;
    }, Buffer.from(bytes).toString("base64"));
    expect(covered, name).toBeGreaterThanOrEqual(23);
  }
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
  await verifyTransitionDraws(page, rangesAt, testInfo, {
    name,
    before,
    after,
  });
}

async function verifyTransitionDraws(
  page: Page,
  rangesAt: TerrainRanges,
  testInfo: TestInfo,
  { name, before, after }: { name: string; before: number; after: number },
) {
  const beforeRanges = rangesAt(before);
  const afterRanges = rangesAt(after);
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
