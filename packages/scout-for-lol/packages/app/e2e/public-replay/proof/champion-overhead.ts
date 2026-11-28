import { expect, type Page, type TestInfo } from "@playwright/test";
import { z } from "zod";

export const expectChampionOverhead =
  Bun.env["SCOUT_REPLAY_E2E_EXPECT_CHAMPION_OVERHEAD"] === "1";

export async function readBlueOverheadName(
  replayPath: string,
  champion: string,
) {
  const replay = Bun.file(replayPath);
  const end = replay.size - 4;
  if (end <= 0)
    throw new Error("Original replay does not have a metadata footer.");
  const length = new DataView(await replay.slice(end).arrayBuffer()).getUint32(
    0,
    true,
  );
  if (length === 0 || length > end || length > 4 * 1024 * 1024)
    throw new Error("Original replay metadata footer has invalid bounds.");
  const { statsJson } = z
    .object({ statsJson: z.string() })
    .parse(await replay.slice(end - length, end).json());
  const roster = z
    .array(
      z.object({
        SKIN: z.string(),
        TEAM: z.enum(["100", "200"]),
        RIOT_ID_GAME_NAME: z.string().min(1).optional(),
      }),
    )
    .length(10)
    .parse(JSON.parse(statsJson));
  const matches = roster.filter(
    (row) => row.SKIN === champion && row.TEAM === "100",
  );
  if (matches.length !== 1 || matches[0]?.RIOT_ID_GAME_NAME === undefined)
    throw new Error(
      "Original replay must have a unique named blue-side champion.",
    );
  return matches[0].RIOT_ID_GAME_NAME;
}

async function expectOverheadName(
  page: Page,
  participantId: number,
  name: string,
) {
  const label = overhead(page, participantId).locator(
    "[data-scout-champion-name]",
  );
  await expect
    .poll(async () => (await label.textContent()) === name, {
      message: "Overhead player name must match the replay footer.",
    })
    .toBe(true);
}

function overhead(page: Page, participantId: number) {
  return page.locator(
    `[data-scout-champion-overhead] [data-participant-id="${String(participantId)}"]`,
  );
}

export async function verifyChampionOverhead(
  page: Page,
  {
    time,
    resourceValue,
    playerName,
  }: {
    time: 0 | 120;
    resourceValue: string;
    playerName: string | undefined;
  },
  testInfo: TestInfo,
) {
  if (playerName === undefined) return;
  const label = overhead(page, 1_073_742_162);
  await expect(label).toBeVisible();
  await expectOverheadName(page, 1_073_742_162, playerName);
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

export async function verifyOverheadTeamVision(page: Page, replayFile: string) {
  const playerName = await readBlueOverheadName(replayFile, "Heimerdinger");
  const camera = page.getByRole("combobox", { name: "Camera" });
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const label = overhead(page, 1_073_742_161);
  await expect(
    page.locator("[data-scout-champion-overhead] [data-participant-id]"),
  ).toHaveCount(0);
  await camera.selectOption("player:1073742161");
  await expect(label).toHaveCount(0);
  await vision.selectOption("all");
  await expectOverheadName(page, 1_073_742_161, playerName);
  await vision.selectOption("red");
  await expect(label).toHaveCount(0);
  await camera.selectOption("free");
}

export function centerChampionHealthFill(page: Page, screenshot: Buffer) {
  return page.evaluate(async (png) => {
    const frame = new globalThis.Image();
    frame.src = `data:image/png;base64,${png}`;
    await frame.decode();
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Cannot inspect the replay frame.");
    context.drawImage(frame, 0, 0);

    // Following the champion centers its anchor horizontally. Read the blue
    // gauge fill from the captured WebGL frame, including the one-pixel case.
    const left = Math.round(frame.width / 2 - 27);
    const top = Math.floor(frame.height * 0.37);
    const height = Math.ceil(frame.height * 0.12);
    const { data } = context.getImageData(left, top, 54, height);
    const matches = (offset: number, r: number, g: number, b: number) =>
      data[offset] === r && data[offset + 1] === g && data[offset + 2] === b;
    for (let row = 0; row < height - 6; row += 1) {
      const start = row * 54 * 4;
      const inside = start + 55 * 4;
      if (
        !matches(start, 15, 23, 31) ||
        !matches(start + 53 * 4, 15, 23, 31) ||
        !matches(inside, 94, 173, 212)
      )
        continue;
      let width = 1;
      while (width < 52 && matches(inside + width * 4, 94, 173, 212))
        width += 1;
      return width;
    }
    return 0;
  }, screenshot.toString("base64"));
}
