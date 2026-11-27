import { expect, test } from "@playwright/test";
import {
  installRecordedAudioProbe,
  readRecordedAudioProbe,
} from "./recorded-audio-probe.ts";
import { readRecordedReplay, replayPath } from "./recorded-replay-data.ts";
import {
  observeRecordedReplayRequests,
  seek,
} from "./recorded-replay-fixture.ts";

const welcomeFrames = 127_490;
const minionFrames = 96_800;
const objectiveCues = [
  { mediaId: 56_523_430, frames: 232_332, time: 758.777796875 },
  { mediaId: 963_276_642, frames: 314_891, time: 922.249119140625 },
];
const currentObjectiveCues = [
  { mediaId: 56_523_430, frames: 232_332, time: 880.05915234375 },
  { mediaId: 963_276_642, frames: 314_891, time: 975.6594067382813 },
];

test.use({
  launchOptions: {
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--mute-audio",
    ],
  },
});

test("announcer preview stays silent until enabled and follows the replay clock", async ({
  baseURL,
  page,
}, testInfo) => {
  if (baseURL === undefined)
    throw new Error("A loopback base URL is required.");
  const fixture = await readRecordedReplay();
  const clipPaths = [...fixture.paths.keys()].filter(
    (url) => url.includes("/announcer-preview/") && url.endsWith(".wav"),
  );
  const current = fixture.descriptor.gameBuild === "16.23.841.8428";
  const expectedObjectives = current ? currentObjectiveCues : objectiveCues;
  const additionalCues = expectedObjectives.filter(({ mediaId }) =>
    clipPaths.some((url) => url.endsWith(`/${String(mediaId)}.wav`)),
  );
  if (current) expect(additionalCues).toEqual(currentObjectiveCues);
  expect(clipPaths).toHaveLength(2 + additionalCues.length);
  const traffic = await observeRecordedReplayRequests(page, baseURL);
  await installRecordedAudioProbe(page);
  await page.goto(replayPath);
  const toggle = page.getByRole("button", {
    name: "Announcer preview (Female1 English)",
  });
  const play = page.getByRole("button", { name: "Play", exact: true });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await seek(page, 20.5);
  await play.click();
  await pause.click();
  expect(await readRecordedAudioProbe(page)).toMatchObject({
    contextCount: 0,
    starts: [],
  });
  for (const clipPath of clipPaths)
    expect(traffic.requested).not.toContain(clipPath);

  await seek(page, 19);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await readRecordedAudioProbe(page)).toMatchObject({
    contextCount: 1,
    starts: [],
  });
  await play.click();
  await expect
    .poll(async () => {
      const { starts } = await readRecordedAudioProbe(page);
      return starts;
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frames: welcomeFrames, offset: 0, rate: 1 }),
      ]),
    );
  await pause.click();
  const first = await readRecordedAudioProbe(page);
  const welcome = first.starts.find(({ frames }) => frames === welcomeFrames);
  if (welcome === undefined) throw new Error("Welcome clip did not start");
  expect(welcome.delay).toBeGreaterThan(0);
  expect(welcome.delay).toBeLessThan(1.2);
  expect(first.stops).toContain(welcome.id);

  await seek(page, 20.5);
  await page.getByRole("combobox", { name: "Speed" }).selectOption("4");
  const beforeResume = await readRecordedAudioProbe(page);
  expect(beforeResume.starts).toHaveLength(first.starts.length);
  await play.click();
  await expect
    .poll(async () => {
      const playback = await readRecordedAudioProbe(page);
      return playback.starts
        .slice(first.starts.length)
        .find(({ frames }) => frames === welcomeFrames);
    })
    .toMatchObject({ rate: 4 });
  const resumed = await readRecordedAudioProbe(page);
  const suffix = resumed.starts
    .slice(first.starts.length)
    .find(({ frames }) => frames === welcomeFrames);
  if (suffix === undefined) throw new Error("Welcome suffix did not start");
  expect(suffix.offset).toBeGreaterThan(0.4);
  expect(suffix.offset).toBeLessThan(0.7);
  const slider = page.getByRole("slider", { name: "Replay time" });
  await slider.press("Home");
  await expect
    .poll(async () => {
      const playback = await readRecordedAudioProbe(page);
      return playback.starts
        .slice(resumed.starts.length)
        .find(({ frames }) => frames === welcomeFrames);
    })
    .toMatchObject({ offset: 0, rate: 4 });
  const rewound = await readRecordedAudioProbe(page);
  expect(rewound.stops).toContain(suffix.id);
  await pause.click();

  await seek(page, 29);
  const beforeMinions = await readRecordedAudioProbe(page);
  await play.click();
  await expect
    .poll(async () => {
      const playback = await readRecordedAudioProbe(page);
      return playback.starts
        .slice(beforeMinions.starts.length)
        .find(({ frames }) => frames === minionFrames);
    })
    .toMatchObject({ offset: 0, rate: 4 });
  for (const cue of additionalCues) {
    await pause.click();
    const start = Math.floor(cue.time - (current ? 1 : 0));
    await seek(page, start);
    const beforeObjective = await readRecordedAudioProbe(page);
    await play.click();
    await expect
      .poll(async () => {
        const playback = await readRecordedAudioProbe(page);
        return playback.starts
          .slice(beforeObjective.starts.length)
          .find(({ frames }) => frames === cue.frames);
      })
      .toMatchObject({ offset: 0, rate: 4 });
    const playback = await readRecordedAudioProbe(page);
    const transition = playback.starts
      .slice(beforeObjective.starts.length)
      .find(({ frames }) => frames === cue.frames);
    if (transition === undefined)
      throw new Error("Objective cue did not start");
    expect(transition.delay).toBeGreaterThan(0);
    expect(transition.delay).toBeCloseTo((cue.time - start) / 4, 1);
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const muted = await readRecordedAudioProbe(page);
  expect(muted.stops).toEqual(
    expect.arrayContaining(muted.starts.map(({ id }) => id)),
  );
  for (const clipPath of clipPaths)
    expect(traffic.requested).toContain(clipPath);
  expect(traffic.credentialed.size).toBe(0);
  await pause.click();
  await seek(page, 19);
  await play.click();
  await expect
    .poll(async () => Number(await page.getByRole("slider").inputValue()))
    .toBeGreaterThan(20.1);
  const replay = await readRecordedAudioProbe(page);
  expect(replay.starts).toHaveLength(muted.starts.length);
  await Bun.write(
    testInfo.outputPath("announcer-scheduling.json"),
    JSON.stringify(replay, null, 2),
  );
});
