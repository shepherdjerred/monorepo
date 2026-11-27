import { expect, type Page, type TestInfo } from "@playwright/test";
import type { readRecordedReplay } from "./recorded-replay-data.ts";
import { seek } from "./recorded-replay-fixture.ts";
import { centerMinimapOn, drawsNear } from "./recorded-world-assertions.ts";

const witnesses = [
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

export async function verifyRecordedInhibitorReturns(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
  testInfo: TestInfo,
) {
  const instances = fixture.inhibitorInstances;
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
  for (const { position, indices, returnedAt } of witnesses) {
    const [x, z] = position;
    const instance = instances.find(
      ({ position: [px, , pz] }) => Math.hypot(x - px, z - pz) < 0.001,
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
