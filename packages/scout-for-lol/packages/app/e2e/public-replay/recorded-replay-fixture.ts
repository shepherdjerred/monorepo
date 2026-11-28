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

const ParticleComponents = z.array(
  z.object({
    lifetime: z.number(),
    samples: z.array(z.object({ age: z.number() })),
  }),
);
const FamilyParticleTrack = z.object({
  effects: z.array(z.object({ start: z.number(), family: z.string() })).min(1),
  families: z.array(
    z.object({ id: z.string(), components: ParticleComponents }),
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
        worldRibbon: z.object({
          paths: z.array(
            z.object({
              start: z.number(),
              end: z.number(),
              samples: z.array(z.object({ age: z.number() })).nonempty(),
            }),
          ),
        }),
      }),
    ])
    .parse(
      await Bun.file(path.join(fixture.root, "recorded-particles.json")).json(),
    );
}

export async function verifyRecordedParticlePreview(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  const track = await readRecordedParticleTrack(fixture);
  if (track === undefined) return;
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const count = async () => {
    const draw = await readRecordedDraw(page);
    return draw.recordedParticleDraws;
  };
  const expectAt = async (seconds: number, draws: number) => {
    await seek(page, seconds);
    await expect.poll(count).toBe(draws);
  };
  const expectedDraws = (time: number) => {
    const expectedFor = (
      start: number,
      parts: z.infer<typeof ParticleComponents>,
    ) => {
      const age = time - start;
      return parts.filter(
        ({ lifetime, samples }) =>
          age < lifetime && samples.some((sample) => sample.age <= age),
      ).length;
    };
    if (track.schema === 1)
      return track.effects.reduce(
        (draws, { start }) => draws + expectedFor(start, track.components),
        0,
      );
    const families = new Map(
      track.families.map(({ id, components: parts }) => [id, parts]),
    );
    const ribbons =
      track.schema === 4
        ? track.worldRibbon.paths.filter(
            ({ start, end, samples }) =>
              time < end && samples.some(({ age }) => age <= time - start),
          ).length
        : 0;
    return track.effects.reduce((draws, { start, family }) => {
      const parts = families.get(family);
      if (parts === undefined)
        throw new Error("Missing recorded effect family.");
      return draws + expectedFor(start, parts);
    }, ribbons);
  };

  await vision.selectOption("all");
  if (track.effects.length > 100) {
    // Five distinct impacts share one start time in the recorded fight.
    await expectAt(1715.7, 10);
    await expectAt(1716, 0);
    await expectAt(1715.7, 10);
  }
  if (
    track.schema !== 1 &&
    track.families.some(({ id }) => id === "kaisa-e-activation")
  ) {
    await expectAt(1719, 1);
    await expectAt(1719.2, 0);
    await expectAt(1719, 1);
  }
  if (
    (track.schema === 3 || track.schema === 4) &&
    track.families.some(({ id }) => id === "senna-soul-death")
  ) {
    await expectAt(254.7, 0);
    await expectAt(255, 1);
    await expectAt(255.3, 0);
    await expectAt(255, 1);
  }
  if (track.schema === 4) {
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
