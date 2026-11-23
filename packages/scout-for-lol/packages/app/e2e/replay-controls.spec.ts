import { expect, test } from "@playwright/test";
import { mountStory } from "@scout-for-lol/design-system/storybook/e2e";

test("research scoreboard follows forward and backward timeline seeks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await mountStory(page, {
    id: "replay-public-player--research-scoreboard",
    skin: "modern",
    mode: "dark",
  });
  const braum = page
    .getByRole("table", { name: "Team A" })
    .getByRole("row", { name: /Braum/ });
  const seek = page.getByRole("slider", { name: "Match time" });
  await expect(braum.getByRole("cell")).toHaveText(["0", "0", "0"]);
  await page.getByRole("button", { name: /Champion kill.*Braum/ }).click();
  await expect(seek).toHaveValue("4000");
  await expect(braum.getByRole("cell")).toHaveText(["1", "0", "0"]);
  const unresolved = page
    .getByRole("table", { name: "Team B" })
    .getByRole("row", { name: /Unresolved participant/ });
  await expect(unresolved.getByRole("cell")).toHaveText("Unverified");
  const analysis = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Replay combat analysis" }),
  });
  const overflow = await analysis.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(overflow).toBe(false);
  await analysis.screenshot({ path: test.info().outputPath("scoreboard.png") });
  await seek.press("Home");
  await expect(braum.getByRole("cell")).toHaveText(["0", "0", "0"]);
  expect(errors).toEqual([]);
});

test("replay analysis restores a timestamp and shares keyboard-selected events", async ({
  page,
}) => {
  const replayAssetRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      /(?:^|\.)(?:communitydragon\.org|leagueoflegends\.com|riotgames\.com)$/i.test(
        url.hostname,
      ) ||
      /\/replay-assets\/|\.(?:rofl|wad)(?:\.client)?$/i.test(url.pathname)
    ) {
      replayAssetRequests.push(url.href);
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText(value: string) {
          sessionStorage.setItem("copied-replay-link", value);
          return Promise.resolve();
        },
      },
    });
  });
  const errors = await mountStory(page, {
    id: "replay-public-player--analysis-timeline",
    skin: "modern",
    mode: "dark",
  });
  await expect(
    page.getByRole("heading", { name: "Replay playback is being prepared" }),
  ).toBeVisible();
  const slider = page.getByRole("slider", { name: "Match time" });
  await expect(slider).toHaveValue("735860");
  await expect(slider).toHaveAttribute("aria-valuetext", "12:15");
  const turret = page.getByRole("button", { name: /Outer turret destroyed/ });
  await expect(turret).toHaveAttribute("aria-current", "time");

  const filter = page.getByRole("combobox", { name: "Event type" });
  await filter.selectOption({ label: "Neutral objectives" });
  await expect(turret).toHaveCount(0);
  await filter.focus();
  await page.keyboard.press("Tab");
  const drake = page.getByRole("button", { name: /8:40 Cloud Drake/ });
  await expect(drake).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drake).toBeFocused();
  await expect(drake).toHaveAttribute("aria-current", "time");
  await expect(slider).toHaveValue("520144");

  await page.getByRole("button", { name: "Copy timestamp link" }).click();
  await expect(page.getByText("Link to 8:40 copied.")).toBeVisible();
  const copied = await page.evaluate(() =>
    globalThis.sessionStorage.getItem("copied-replay-link"),
  );
  expect(copied).toBe(new URL("/iframe.html?t=520.144", page.url()).href);

  await slider.press("ArrowLeft");
  await expect(slider).not.toHaveValue("520144");
  await expect(drake).not.toHaveAttribute("aria-current", "time");
  await page.clock.install();
  await page
    .getByRole("combobox", { name: "Timeline speed" })
    .selectOption("4");
  await page.getByRole("button", { name: "Play timeline" }).click();
  await page.clock.runFor(5000);
  await expect(drake).toHaveAttribute("aria-current", "time");
  await page.getByRole("button", { name: "Pause timeline" }).click();
  await expect(
    page.getByRole("button", { name: "Play timeline" }),
  ).toBeVisible();
  const pausedTime = await slider.inputValue();
  await page.clock.runFor(1000);
  await expect(slider).toHaveValue(pausedTime);

  await expect(
    page
      .locator("#storybook-root")
      .locator("canvas, img, picture, video, audio, object, embed, svg"),
  ).toHaveCount(0);
  expect(replayAssetRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("pending scrubs survive input/change events and older presentation frames", async ({
  page,
}) => {
  const errors = await mountStory(page, {
    id: "replay-public-player--delayed-seek-controls",
    skin: "modern",
    mode: "dark",
  });
  const slider = page.getByRole("slider", { name: "Replay time" });
  await expect(slider).toHaveValue("52.7");
  await slider.evaluate((element) => {
    if (!(element instanceof HTMLInputElement))
      throw new TypeError("Replay slider is missing");
    element.stepUp(
      Math.round((79.8 - element.valueAsNumber) / Number(element.step)),
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(slider).toHaveValue("79.8");
  await expect(slider).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "Present older frame" }).click();
  await expect(slider).toHaveValue("79.8");
  await slider.evaluate((element) => {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(slider).toHaveValue("79.8");
  await expect(page.getByRole("status", { name: "Seek requests" })).toHaveText(
    "79.8",
  );
  await page.getByRole("button", { name: "Complete latest seek" }).click();
  await expect(slider).toHaveValue("79.8");
  await expect(slider).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("fatal runtime failures retire their session and stale failures cannot replace a retry", async ({
  page,
}) => {
  const errors = await mountStory(page, {
    id: "replay-public-player--runtime-failure-recovery",
    skin: "modern",
    mode: "dark",
  });
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("slider", { name: "Replay time" })).toHaveValue(
    "0",
  );
  await page
    .getByRole("button", { name: "Fail active replay", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText("Replay worker stopped");
  await expect(
    page.getByLabel("League of Legends replay scene"),
  ).toHaveAttribute("tabindex", "-1");
  await page.screenshot({
    path: test.info().outputPath("runtime-failure.png"),
  });
  await expect(
    page.getByRole("status", { name: "Disposed sessions" }),
  ).toHaveText("1");
  await page
    .getByRole("button", { name: "Reload replay", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("League of Legends replay scene"),
  ).toHaveAttribute("tabindex", "0");
  await page
    .getByRole("button", { name: "Fail retired replay", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Disposed sessions" }),
  ).toHaveText("1");
  expect(errors).toEqual([]);
});

test("a renderer resize failure retires the shared replay session and allows reload", async ({
  page,
}) => {
  const errors = await mountStory(page, {
    id: "replay-public-player--runtime-failure-recovery",
    skin: "modern",
    mode: "dark",
  });
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible();
  await page
    .getByRole("button", { name: "Fail active replay on resize" })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Replay renderer resize failed",
  );
  await expect(play).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Disposed sessions" }),
  ).toHaveText("1");
  await page.getByRole("button", { name: "Reload replay" }).click();
  await expect(play).toBeVisible();
  expect(errors).toEqual([]);
});

test("command failure stays visible when disposal throws", async ({ page }) => {
  const errors = await mountStory(page, {
    id: "replay-public-player--runtime-failure-recovery",
    skin: "modern",
    mode: "dark",
  });
  const play = page.getByRole("button", { name: "Play", exact: true });
  await page
    .getByRole("button", { name: "Fail next play and disposal" })
    .click();
  await play.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Replay play command failed",
  );
  await expect(play).toHaveCount(0);
  const disposals = page.getByRole("status", { name: "Disposed sessions" });
  await expect(disposals).toHaveText("1");
  await page.getByRole("region", { name: "Replay player" }).screenshot({
    path: test.info().outputPath("command-failure.png"),
  });
  await page.getByRole("button", { name: "Reload replay" }).click();
  await expect(play).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(disposals).toHaveText("1");
  expect(errors).toEqual([]);
});
