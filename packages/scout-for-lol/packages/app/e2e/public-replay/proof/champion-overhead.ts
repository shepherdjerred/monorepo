import { expect, type Page, type TestInfo } from "@playwright/test";

export const expectChampionOverhead =
  Bun.env["SCOUT_REPLAY_E2E_EXPECT_CHAMPION_OVERHEAD"] === "1";

function overhead(page: Page, participantId: number) {
  return page.locator(
    `[data-scout-champion-overhead] [data-participant-id="${String(participantId)}"]`,
  );
}

export async function verifyChampionOverhead(
  page: Page,
  time: 0 | 120,
  resourceValue: string,
  testInfo: TestInfo,
) {
  if (!expectChampionOverhead) return;
  const label = overhead(page, 1_073_742_162);
  await expect(label).toBeVisible();
  await expect(label.locator("[data-scout-champion-name]")).toHaveText(
    "LeeSin",
  );
  await expect(label.locator("[data-scout-champion-level]")).toHaveText(
    time === 0 ? "1" : "2",
  );
  const resource = label.locator("[data-scout-champion-resource]");
  await expect(resource).toHaveAttribute("value", resourceValue);
  await expect(resource).toHaveAttribute("max", "200");
  if (time === 120) {
    await page.getByRole("region", { name: "Replay player" }).screenshot({
      path: testInfo.outputPath(
        "recorded-current-composed-champion-overhead.png",
      ),
    });
  }
}

export async function verifyOverheadTeamVision(page: Page) {
  const camera = page.getByRole("combobox", { name: "Camera" });
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const label = overhead(page, 1_073_742_161);
  await expect(
    page.locator("[data-scout-champion-overhead] [data-participant-id]"),
  ).toHaveCount(0);
  await camera.selectOption("player:1073742161");
  await expect(label).toHaveCount(0);
  await vision.selectOption("all");
  await expect(label.locator("[data-scout-champion-name]")).toHaveText(
    "Heimerdinger",
  );
  await vision.selectOption("red");
  await expect(label).toHaveCount(0);
  await camera.selectOption("free");
}
