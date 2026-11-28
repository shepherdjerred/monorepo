import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import { readRecordedDraw } from "./recorded-draw-probe.ts";
import {
  apiPath,
  packagePrefix,
  type readRecordedReplay,
} from "./recorded-replay-data.ts";

export async function observeRecordedReplayRequests(
  page: Page,
  origin: string,
) {
  const requested = new Set<string>();
  const credentialed = new Set<string>();
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const { pathname } = url;
    if (pathname.startsWith(apiPath) || pathname.startsWith(packagePrefix)) {
      requested.add(pathname);
      const headers = await request.allHeaders();
      if ("cookie" in headers || "authorization" in headers)
        credentialed.add(pathname);
    }
    return route.continue();
  });
  return { requested, credentialed };
}

export async function seek(page: Page, seconds: number) {
  const slider = page.getByRole("slider", { name: "Replay time" });
  await slider.evaluate((element, target) => {
    const value = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    if (value?.set === undefined)
      throw new Error("Missing range input setter.");
    value.set.call(element, target);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(seconds));
  await expect(slider).toHaveValue(String(seconds));
  await expect(slider).toHaveAttribute("aria-busy", "false");
}

const ParticleComponent = z.object({
  lifetime: z.number(),
  samples: z.array(z.object({ age: z.number() })),
});
const ParticleComponents = z.array(ParticleComponent);
const FamilyParticleTrack = z.object({
  effects: z.array(z.object({ start: z.number(), family: z.string() })).min(1),
  families: z.array(
    z.object({ id: z.string(), components: ParticleComponents }),
  ),
});
const WorldRibbon = z.object({
  paths: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      samples: z.array(z.object({ age: z.number() })).nonempty(),
    }),
  ),
});
const DepthQualifiedParticleTrack = FamilyParticleTrack.extend({
  worldRibbon: WorldRibbon,
  families: z.array(
    z.object({
      id: z.string(),
      components: z.array(ParticleComponent.extend({ depthTest: z.boolean() })),
    }),
  ),
});

export async function readRecordedParticleTrack(
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  if (fixture.particlePreview === undefined) return;
  const effect = z.object({ start: z.number() });
  return z
    .discriminatedUnion("schema", [
      z.object({
        schema: z.literal(1),
        effects: z.array(effect).min(1),
        components: ParticleComponents,
      }),
      FamilyParticleTrack.extend({
        schema: z.union([z.literal(2), z.literal(3)]),
      }),
      FamilyParticleTrack.extend({
        schema: z.literal(4),
        worldRibbon: WorldRibbon,
      }),
      DepthQualifiedParticleTrack.extend({
        schema: z.literal(5),
      }),
      DepthQualifiedParticleTrack.extend({
        schema: z.literal(6),
        worldMaskedQuad: WorldRibbon,
      }),
    ])
    .parse(
      await Bun.file(path.join(fixture.root, "recorded-particles.json")).json(),
    );
}

function expectedFor(
  start: number,
  parts: z.infer<typeof ParticleComponents>,
  time: number,
) {
  const age = time - start;
  return parts.filter(
    ({ lifetime, samples }) =>
      age < lifetime && samples.some((sample) => sample.age <= age),
  ).length;
}

function expectedParticleDraws(
  track: NonNullable<Awaited<ReturnType<typeof readRecordedParticleTrack>>>,
  time: number,
) {
  if (track.schema === 1)
    return track.effects.reduce(
      (draws, { start }) => draws + expectedFor(start, track.components, time),
      0,
    );
  const families = new Map(
    track.families.map(({ id, components: parts }) => [id, parts]),
  );
  const ribbons =
    "worldRibbon" in track
      ? expectedWorldParticleDraws(track.worldRibbon, time)
      : 0;
  const maskedGround =
    track.schema === 6
      ? expectedWorldParticleDraws(track.worldMaskedQuad, time)
      : 0;
  return track.effects.reduce((draws, { start, family }) => {
    const parts = families.get(family);
    if (parts === undefined) throw new Error("Missing recorded effect family.");
    return draws + expectedFor(start, parts, time);
  }, ribbons + maskedGround);
}

function expectedWorldParticleDraws(
  track: z.infer<typeof WorldRibbon>,
  time: number,
) {
  return track.paths.filter(
    ({ start, end, samples }) =>
      time < end && samples.some(({ age }) => age <= time - start),
  ).length;
}

function ammoWitnessClocks(
  components: z.infer<typeof ParticleComponents> | undefined,
  effects: { start: number }[],
  expectedAmmoDraws: (seconds: number) => number,
) {
  if (components === undefined) return [];
  expect(effects).toHaveLength(2);
  const firstSample = Math.min(
    ...components.flatMap(({ samples }) => samples.map(({ age }) => age)),
  );
  const lifetime = Math.max(...components.map((part) => part.lifetime));
  return effects.flatMap(({ start }) => {
    const before = Math.floor(start * 10) / 10;
    const active = Math.ceil((start + firstSample) * 10) / 10;
    const after = Math.ceil((start + lifetime) * 10) / 10;
    expect(expectedAmmoDraws(before)).toBe(0);
    expect(expectedAmmoDraws(active)).toBe(1);
    expect(expectedAmmoDraws(after)).toBe(0);
    return [before, active, after, active];
  });
}

async function verifySnowflashDraws(
  page: Page,
  track: NonNullable<Awaited<ReturnType<typeof readRecordedParticleTrack>>>,
) {
  if (track.schema !== 5 && track.schema !== 6) return;
  const snowflash = track.families.find(
    ({ id }) => id === "anivia-q-snowflash",
  );
  if (snowflash === undefined) return;
  expect(snowflash.components.map(({ depthTest }) => depthTest)).toEqual([
    false,
  ]);
  expect(
    track.effects.filter(({ family }) => family === snowflash.id),
  ).toHaveLength(1);
  for (const [seconds, depthDisabled] of [
    [1714.3, 0],
    [1714.5, 1],
    [1714.6, 0],
    [1714.5, 1],
  ] as const) {
    await seek(page, seconds);
    const total = expectedParticleDraws(track, seconds);
    await expect
      .poll(async () => {
        const draw = await readRecordedDraw(page);
        return [
          draw.recordedParticleDraws,
          draw.recordedDepthDisabledParticleDraws,
        ];
      })
      .toEqual([total, depthDisabled]);
  }
}

async function verifyMaskedGroundDraws(
  page: Page,
  track: NonNullable<Awaited<ReturnType<typeof readRecordedParticleTrack>>>,
) {
  if (track.schema !== 6) return;
  expect(track.worldMaskedQuad.paths).toHaveLength(1);
  for (const [seconds, expected] of [
    [1712.7, 0],
    [1713.2, 1],
    [1714.7, 1],
    [1714.8, 0],
    [1713.2, 1],
  ] as const) {
    expect(expectedWorldParticleDraws(track.worldMaskedQuad, seconds)).toBe(
      expected,
    );
    await seek(page, seconds);
    await expect
      .poll(async () => {
        const draw = await readRecordedDraw(page);
        return [draw.recordedParticleDraws, draw.recordedMaskedGroundDraws];
      })
      .toEqual([expectedParticleDraws(track, seconds), expected]);
  }

  const camera = page.getByRole("combobox", { name: "Camera" });
  const initialCamera = await camera.inputValue();
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const maskedDraws = async () => {
    const { recordedMaskedGroundDraws } = await readRecordedDraw(page);
    return recordedMaskedGroundDraws;
  };
  await camera.selectOption("player:1073742170");
  await expect.poll(maskedDraws).toBe(1);
  for (const [perspective, expected] of [
    ["blue", 0],
    ["red", 0],
    ["all", 1],
  ] as const) {
    await vision.selectOption(perspective);
    await expect.poll(maskedDraws).toBe(expected);
  }
  await camera.selectOption("free");
  await expect.poll(maskedDraws).toBe(1);
  await camera.selectOption(initialCamera);
}

async function verifyYasuoWindWallDraws(
  page: Page,
  track: NonNullable<Awaited<ReturnType<typeof readRecordedParticleTrack>>>,
) {
  if (track.schema === 1) return;
  const flashes = track.families.filter(({ id }) =>
    id.startsWith("yasuo-wind-wall-flash-"),
  );
  if (flashes.length === 0) return;
  expect(flashes).toHaveLength(4);
  for (const { id, components } of flashes) {
    const creates = track.effects.filter(({ family }) => family === id);
    expect(creates).toHaveLength(1);
    expect(components).toHaveLength(1);
    const [create] = creates;
    const [component] = components;
    if (create === undefined || component === undefined)
      throw new Error(`Missing recorded Yasuo flash data for ${id}.`);
    const { start } = create;
    const { lifetime, samples } = component;
    const firstSample = Math.min(...samples.map(({ age }) => age));
    const before = (Math.ceil((start + firstSample) * 10) - 1) / 10;
    const active = Math.ceil((start + firstSample) * 10) / 10;
    const expired = Math.ceil((start + lifetime) * 10) / 10;
    for (const [seconds, activeDraws] of [
      [before, 0],
      [active, 1],
      [expired, 0],
      [active, 1],
    ] as const) {
      expect(expectedFor(start, components, seconds)).toBe(activeDraws);
      await seek(page, seconds);
      await expect
        .poll(async () => {
          const { recordedParticleDraws } = await readRecordedDraw(page);
          return recordedParticleDraws;
        })
        .toBe(expectedParticleDraws(track, seconds));
    }
  }
}

export async function verifyRecordedParticlePreview(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  const track = await readRecordedParticleTrack(fixture);
  if (track === undefined) return;
  const expectedDraws = (time: number) => expectedParticleDraws(track, time);
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const count = async () => {
    const draw = await readRecordedDraw(page);
    return draw.recordedParticleDraws;
  };
  const expectAt = async (seconds: number, draws: number) => {
    await seek(page, seconds);
    await expect.poll(count).toBe(draws);
  };
  const ammoId = "heimerdinger-q-ammo-spend";
  const ammo =
    track.schema === 1
      ? undefined
      : track.families.find(({ id }) => id === ammoId);
  const ammoEffects =
    track.schema === 1
      ? []
      : track.effects.filter(({ family }) => family === ammoId);
  const expectedAmmoDraws = (seconds: number) =>
    ammoEffects.reduce(
      (draws, { start }) =>
        draws + expectedFor(start, ammo?.components ?? [], seconds),
      0,
    );
  await vision.selectOption("all");
  await verifyMaskedGroundDraws(page, track);
  await verifyYasuoWindWallDraws(page, track);
  await verifySnowflashDraws(page, track);
  if (track.effects.length > 100) {
    // Five distinct impacts share one start time in the recorded fight.
    await expectAt(1715.7, 10);
    await expectAt(1716, expectedAmmoDraws(1716));
    await expectAt(1715.7, 10);
  }
  for (const seconds of ammoWitnessClocks(
    ammo?.components,
    ammoEffects,
    expectedAmmoDraws,
  ))
    await expectAt(seconds, expectedDraws(seconds));
  if (
    track.schema !== 1 &&
    track.families.some(({ id }) => id === "kaisa-e-activation")
  ) {
    await expectAt(1719, 1);
    await expectAt(1719.2, 0);
    await expectAt(1719, 1);
  }
  if (
    (track.schema === 3 || "worldRibbon" in track) &&
    track.families.some(({ id }) => id === "senna-soul-death")
  ) {
    await expectAt(254.7, 0);
    await expectAt(255, 1);
    await expectAt(255.3, 0);
    await expectAt(255, 1);
  }
  if ("worldRibbon" in track) {
    for (const seconds of [1713.9, 1714.3, 1714.7, 1714.9, 1715.2, 1714.3])
      await expectAt(seconds, expectedDraws(seconds));
    await vision.selectOption("blue");
    await expect.poll(count).toBe(0);
    await vision.selectOption("red");
    await expect.poll(count).toBe(0);
    await vision.selectOption("all");
    await expect.poll(count).toBe(expectedDraws(1714.3));
  }
  const activeDraws = expectedDraws(2095.2);
  expect(activeDraws).toBeGreaterThan(0);
  await expectAt(2094.9, 0);
  await expectAt(2095.2, activeDraws);
  await vision.selectOption("blue");
  await expect.poll(count).toBe(0);
  await vision.selectOption("all");
  await expect.poll(count).toBe(activeDraws);
  await expectAt(2095.6, 0);
  await expectAt(2095.2, activeDraws);
  await expectAt(2094.9, 0);
}
