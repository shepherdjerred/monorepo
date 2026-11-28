import { expect, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import { readRecordedDraw } from "#replay-e2e/recorded-draw-probe.ts";
import type { readRecordedReplay } from "#replay-e2e/recorded-replay-data.ts";
import { seek } from "#replay-e2e/recorded-replay-fixture.ts";
import type { drawsNear } from "#replay-e2e/recorded-world-assertions.ts";

const TurretRubbleBindings = z.object({
  structureModelBindings: z
    .array(
      z.object({
        collapse: z.object({}).optional(),
        settledRubble: z.object({}).optional(),
      }),
    )
    .optional(),
});

const witnesses = [
  {
    // Loss at 856.478s. The authored Order clip reveals settled rubble 0.067s later.
    position: [981, 37, 10_441],
    before: 856.4,
    transition: 856.5,
    settled: 856.6,
    rubbleDraws: [1551],
  },
  {
    // Loss at 1692.305s. The authored Chaos clip settles after 1.9s.
    position: [11_134, 88, 11_207],
    before: 1692.3,
    transition: 1693,
    settled: 1694.3,
    rubbleDraws: [2946, 6378],
    collapse: true,
  },
];

async function verifyRecordedTurretRubble(page: Page, root: string) {
  const scene = TurretRubbleBindings.parse(
    await Bun.file(path.join(root, "scene.json")).json(),
  );
  if (
    scene.structureModelBindings?.some(
      ({ settledRubble }) => settledRubble !== undefined,
    ) !== true
  )
    return;

  for (const {
    position,
    before,
    transition,
    settled,
    rubbleDraws,
    collapse,
  } of witnesses) {
    const frameAt = async (seconds: number) => {
      await seek(page, seconds);
      const draw = await readRecordedDraw(page);
      const indices = draw.actorOrigins
        .flatMap((origin, index) => {
          const count = draw.actorIndexCounts[index];
          return count !== undefined &&
            position.every(
              (value, axis) =>
                Math.abs(value - (origin[axis] ?? Infinity)) < 0.5,
            )
            ? [count]
            : [];
        })
        .sort((left, right) => left - right);
      return { indices, draw };
    };
    const { indices: live } = await frameAt(before);
    expect(live.length).toBeGreaterThan(0);
    const { indices: collapsing } = await frameAt(transition);
    for (const range of rubbleDraws) {
      expect(live).not.toContain(range);
      expect(collapsing).not.toContain(range);
    }
    const { indices: rubble } = await frameAt(settled);
    expect(rubble).toEqual(rubbleDraws);
    if (
      collapse === true &&
      scene.structureModelBindings.some(
        (binding) => binding.collapse !== undefined,
      )
    ) {
      // Index counts identify Stage2/Stage3 in the pinned Chaos turret GLB.
      const stage2 = 12_009;
      const stage3 = 2976;
      const paletteAt = async (seconds: number, expected: number[]) => {
        const { indices, draw } = await frameAt(seconds);
        expect(indices).toEqual(expected);
        // The renderer uploads a palette before submitting the first authored range.
        const firstRange = expected.includes(stage2) ? stage2 : stage3;
        expect(
          draw.actorIndexCounts.filter((count) => count === firstRange),
        ).toEqual([firstRange]);
        const palettes = draw.animationPaletteDraws.filter(
          ({ indexCount }) => indexCount === firstRange,
        );
        expect(palettes).toHaveLength(1);
        return palettes[0]?.hash;
      };
      const first = await paletteAt(1692.4, [stage3, stage2]);
      const middle = await paletteAt(1692.6, [stage3, stage2]);
      const beforeStage2Hide = await paletteAt(1692.8, [stage3, stage2]);
      const afterStage2Hide = await paletteAt(1692.9, [stage3]);
      const beforeRubble = await paletteAt(1694.2, [stage3]);
      expect(
        new Set([
          first,
          middle,
          beforeStage2Hide,
          afterStage2Hide,
          beforeRubble,
        ]).size,
      ).toBe(5);
      expect(await paletteAt(1692.6, [stage3, stage2])).toBe(middle);
    }
    const { indices: rewound } = await frameAt(before);
    expect(rewound).toEqual(live);
  }
}

export async function verifyCurrentStructureLosses(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
  testInfo: TestInfo,
  hasDraw: typeof drawsNear,
) {
  const paths = [...fixture.paths.keys()];
  const liveWitnesses = [
    {
      kind: "structure",
      indices: 10_074,
      position: [981, 10_441],
      before: 856.4,
      after: 856.5,
    },
    {
      kind: "inhibitor",
      indices: 6675,
      position: [3210.616, 3217.527],
      before: 2062.5,
      after: 2062.6,
    },
    {
      kind: "nexus",
      indices: 14_340,
      position: [13_243, 13_235],
      before: 2407.2,
      after: 2407.3,
    },
  ] as const;
  for (const { kind, indices, position, before, after } of liveWitnesses) {
    if (!paths.some((url) => url.includes(`/${kind}-models/`))) continue;
    await seek(page, before);
    expect(await hasDraw(page, indices, position)).toBe(true);
    await seek(page, after);
    expect(await hasDraw(page, indices, position)).toBe(false);
    await seek(page, before);
    expect(await hasDraw(page, indices, position)).toBe(true);
    await page.getByLabel("League of Legends replay scene").screenshot({
      path: testInfo.outputPath(`recorded-current-${kind}-before-loss.png`),
    });
  }
  if (paths.some((url) => url.includes("/inhibitor-models/"))) {
    const events = page.getByRole("combobox", { name: "Jump to event" });
    await expect(
      events.getByRole("option", { name: /inhibitor destroyed/i }),
    ).toHaveCount(5);
  }
  if (
    fixture.descriptor.sha256 ===
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
  )
    await verifyRecordedTurretRubble(page, fixture.root);
}
