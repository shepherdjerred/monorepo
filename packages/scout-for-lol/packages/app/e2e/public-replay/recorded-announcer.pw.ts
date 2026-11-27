import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import {
  installRecordedAudioProbe,
  readRecordedAudioProbe,
} from "./recorded-audio-probe.ts";
import {
  readRecordedReplay,
  replayPath,
  sha256,
} from "./recorded-replay-data.ts";
import { readDirectAnnouncerWorker } from "./proof/champion-stats-worker.ts";
import { observeDirectChampionStatsWorker } from "./proof/motion-worker-capture.ts";
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

async function readAnnouncerOracle() {
  const root = Bun.env["SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY"];
  if (root === undefined || root === "")
    throw new Error(
      "Set SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY for the direct announcer proof.",
    );
  const bytes = await Bun.file(
    path.join(root, "current-8428-announcer-proof", "receipt.json"),
  ).bytes();
  expect(sha256(bytes)).toBe(
    "33ec8c642051dfcc110824dd82313b29e1c7e1778e378c34b7df91f50bed559d",
  );
  return z
    .object({
      replaySha256: z.string(),
      build: z.string(),
      protocol: z.string(),
      results: z
        .array(
          z.object({
            cue: z.object({
              event: z.number().int().nonnegative(),
              mediaId: z.number().int().positive(),
              timeSeconds: z.number().nonnegative(),
              frames: z.number().int().positive(),
            }),
            wavSha256: z.string(),
          }),
        )
        .length(4),
    })
    .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

async function setupDirectAnnouncer(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
  clipPaths: string[],
) {
  const events = fixture.announcerEvents;
  if (events === undefined) return;
  const oracle = await readAnnouncerOracle();
  expect(oracle.replaySha256).toBe(fixture.descriptor.sha256);
  expect(oracle.build).toBe(fixture.descriptor.gameBuild);
  expect(oracle.protocol).toBe(fixture.descriptor.protocol);
  expect(fixture.announcerPreview).toBe("female1-en-us");
  expect([...fixture.paths.values()]).not.toContain(
    "announcer-preview/cues.json",
  );
  expect(new Map(events)).toEqual(
    new Map(oracle.results.map(({ cue }) => [cue.event, cue.mediaId])),
  );
  expect(events).toHaveLength(oracle.results.length);
  expect(clipPaths.map((clip) => path.posix.basename(clip)).sort()).toEqual(
    oracle.results.map(({ cue }) => `${String(cue.mediaId)}.wav`).sort(),
  );
  await observeDirectChampionStatsWorker(page);
  return oracle;
}

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
  const direct = fixture.announcerEvents !== undefined;
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
  const oracle = await setupDirectAnnouncer(page, fixture, clipPaths);
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
  if (oracle !== undefined) {
    expect(await readDirectAnnouncerWorker(page)).toEqual(
      oracle.results.map(({ cue }) => ({
        timeSeconds: cue.timeSeconds,
        mediaId: cue.mediaId,
      })),
    );
  }
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
  const playbackRate = direct ? 1 : 4;
  await page
    .getByRole("combobox", { name: "Speed" })
    .selectOption(String(playbackRate));
  const beforeMinions = await readRecordedAudioProbe(page);
  await play.click();
  await expect
    .poll(async () => {
      const playback = await readRecordedAudioProbe(page);
      return playback.starts
        .slice(beforeMinions.starts.length)
        .find(({ frames }) => frames === minionFrames);
    })
    .toMatchObject({ offset: 0, rate: playbackRate });
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
      .toMatchObject({ offset: 0, rate: playbackRate });
    const playback = await readRecordedAudioProbe(page);
    const transition = playback.starts
      .slice(beforeObjective.starts.length)
      .find(({ frames }) => frames === cue.frames);
    if (transition === undefined)
      throw new Error("Objective cue did not start");
    expect(transition.delay).toBeGreaterThan(0);
    expect(transition.delay).toBeCloseTo((cue.time - start) / playbackRate, 1);
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const muted = await readRecordedAudioProbe(page);
  expect(muted.stops).toEqual(
    expect.arrayContaining(muted.starts.map(({ id }) => id)),
  );
  for (const clipPath of clipPaths)
    expect(traffic.requested).toContain(clipPath);
  if (oracle !== undefined) {
    expect(
      new Map(
        muted.starts
          .filter(({ rate, offset }) => rate === 1 && offset === 0)
          .map(({ frames, wavSha256 }) => [frames, wavSha256]),
      ),
    ).toEqual(
      new Map(
        oracle.results.map(({ cue, wavSha256 }) => [cue.frames, wavSha256]),
      ),
    );
    expect(
      [...traffic.requested].some((url) =>
        url.endsWith("/announcer-preview/cues.json"),
      ),
    ).toBe(false);
  }
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
