import { expect, test } from "@playwright/test";
import {
  installRecordedDrawProbe,
  readRecordedDraw,
} from "#replay-e2e/recorded-draw-probe.ts";
import {
  contentPath,
  readRecordedReplay,
  replayPath,
  sha256,
} from "#replay-e2e/recorded-replay-data.ts";
import {
  observeRecordedReplayRequests,
  seek,
} from "#replay-e2e/recorded-replay-fixture.ts";
import {
  readFooterScores,
  verifyFooterRoster,
} from "./recorded-footer-score.ts";
import {
  observeMayhemFlowMap,
  verifyMayhemFlowMap,
} from "./recorded-mayhem-flowmap.ts";

const mayhemReplaySha256 =
  "4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7";

test("signed-out Bloom replay plays the opening fight at 1× and restores a share", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const fixture = await readRecordedReplay();
  const footer = await readFooterScores(fixture.roflPath);
  expect(fixture.descriptor).toMatchObject({
    mapId: 12,
    gameMode: "KIWI",
    sha256: mayhemReplaySha256,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  await installRecordedDrawProbe(page);
  const response = await page.goto(replayPath);
  expect(response?.ok()).toBe(true);

  const play = page.getByRole("button", { name: "Play", exact: true });
  const canvas = page.getByLabel("League of Legends replay scene");
  const slider = page.getByRole("slider", { name: "Replay time" });
  const camera = page.getByRole("combobox", { name: "Camera" });
  const score = page.getByRole("group", { name: "Replay team score" });
  await expect(play).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Speed" })).toHaveValue("1");
  await seek(page, 60);
  await expect(camera.getByRole("option")).toHaveCount(11);
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  const opening = await readRecordedDraw(page);
  expect(opening.texturedIndices).toBeGreaterThan(0);
  expect(
    new Set(opening.actorOrigins.map((origin) => origin.join(","))).size,
  ).toBe(10);
  const openingPixels = sha256(
    await canvas.screenshot({
      path: testInfo.outputPath("bloom-opening-fight.png"),
    }),
  );
  await play.click();
  await expect
    .poll(async () => Number(await slider.inputValue()), {
      timeout: 45_000,
    })
    .toBeGreaterThanOrEqual(90);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(
    sha256(
      await canvas.screenshot({
        path: testInfo.outputPath("bloom-after-fight.png"),
      }),
    ),
  ).not.toBe(openingPixels);
  await seek(page, 60);
  expect(await readRecordedDraw(page)).toMatchObject({
    actorOrigins: opening.actorOrigins,
  });

  const jumps = page.getByRole("combobox", { name: "Jump to event" });
  const eliminations = jumps.locator('optgroup[label="Eliminations"] option');
  await expect(eliminations).toHaveCount(footer.blueKills + footer.redKills);
  const firstElimination = await eliminations.first().getAttribute("value");
  if (firstElimination === null)
    throw new Error("Missing first Mayhem elimination target.");
  await jumps.selectOption(firstElimination);
  await expect(slider).toHaveAttribute("aria-valuetext", "1:24");
  await expect(slider).toHaveAttribute("aria-busy", "false");
  await expect(score).toContainText(/Red team\s*1\s*kills/);
  await slider.press("End");
  await expect(score.getByText(footer.winner)).toBeVisible();
  await expect(slider).toHaveAttribute("aria-busy", "false");
  await verifyFooterRoster(page, footer.roster);
  await seek(page, 60);
  await expect(score).toContainText(/Red team\s*0\s*kills/);
  await expect(score).not.toContainText(footer.winner);
  expect(traffic.requested).toContain(contentPath);
  expect(traffic.requested).toContain(fixture.packageUrl);
  expect(traffic.credentialed.size).toBe(0);
  expect(errors).toEqual([]);

  const shared = await browser.newPage();
  try {
    const flowControl = [...fixture.paths.values()].includes(
      "flowmap-control/manifest.json",
    );
    if (flowControl) await observeMayhemFlowMap(shared);
    const share = new URL(replayPath, baseURL);
    share.search = new URLSearchParams({
      t: "65",
      follow: "1073741892",
    }).toString();
    const sharedResponse = await shared.goto(share.href);
    expect(sharedResponse?.ok()).toBe(true);
    await expect(
      shared.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
    await expect(
      shared.getByRole("slider", { name: "Replay time" }),
    ).toHaveValue("65");
    await expect(shared.getByRole("combobox", { name: "Camera" })).toHaveValue(
      "player:1073741892",
    );
    const soraka = shared.getByRole("row").filter({
      has: shared.getByText("Soraka", { exact: true }),
    });
    await expect(soraka.getByRole("cell").nth(3)).toHaveText("3");
    const health = soraka.getByRole("meter", { name: / health$/ });
    await expect(health).toHaveAttribute("value", "673.7326049804688");
    await expect(health).toHaveAttribute("max", "799.505859375");
    if (fixture.championExperience) {
      const progress = soraka.getByRole("meter", { name: / experience$/ });
      await expect(progress).toHaveAttribute("value", "320.5");
      await expect(progress).toHaveAttribute("max", "478");
      await expect(soraka.getByText("982.5 total XP")).toBeVisible();
    }
    if (flowControl) await verifyMayhemFlowMap(shared);
    await shared.screenshot({ path: testInfo.outputPath("bloom-soraka.png") });
  } finally {
    await shared.close();
  }
});
