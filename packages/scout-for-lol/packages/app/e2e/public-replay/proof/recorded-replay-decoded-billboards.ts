import { expect, type Page } from "@playwright/test";
import type { readRecordedReplay } from "#replay-e2e/recorded-replay-data.ts";
import { seek } from "#replay-e2e/recorded-replay-fixture.ts";
import { installRiftFightTextureProbe } from "./rift-fight-texture-probe.ts";

const decodedBillboardTextures = {
  "3b38892fe260d501aa7ae6f2d3026d7cf28e9b92f88beb0b72060282e41ca44d":
    "senna-w-ground-impact-flare",
  a177eee4d856d39db66d579c806ce0fe3cfc72063069860fdb74d2e53a1632d9:
    "heimerdinger-w-impact",
  "13678fbc62c31d02bc3ae0f66f92ad03b8a25ff87f22d0e23180ced7189a57c1":
    "heimerdinger-w-impact",
  "0df0fde80d211e8b9f53222a27b197fa79701a88e049a103554985cb1c1ac633":
    "heimerdinger-q-ammo-spend",
  "33fbb0aa732bf24befe556da253e9fefbac5f19fa1f3551924c4b1f85d63f10b":
    "kaisa-e-activation",
  "53addee5bec42785b92353da116c1b7cacb58ef0c91e83b0846a7466c0327958":
    "senna-soul-death",
  da843215267b2ff311adb960c166b3b57138c2ae857f8fc7fa4450547593e17b:
    "maokai-e-ground-glow",
  "5d12032cdab3f822722f45ac312843f78b3723572181bc760d76d231cee027ce":
    "maokai-r-trails",
};

export async function installReplayDecodedBillboardProbe(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
) {
  if (fixture.replayDecodedBillboards)
    await installRiftFightTextureProbe(page, decodedBillboardTextures);
}

export async function verifyReplayDecodedBillboards(
  page: Page,
  fixture: Awaited<ReturnType<typeof readRecordedReplay>>,
  requested: ReadonlySet<string>,
) {
  if (!fixture.replayDecodedBillboards) return;
  const resources = [...requested];
  const groundPath = [...fixture.paths].find(
    ([, asset]) => asset === "rift-world-quads.json",
  )?.[0];
  if (groundPath !== undefined) expect(requested.has(groundPath)).toBe(true);
  const hasRibbons = [...fixture.paths.values()].includes("rift-ribbon.json");
  if (hasRibbons) {
    for (const leaf of [
      "rift-ribbon.json",
      "rift-projectile-worker.mjs",
      "rift-projectile-pages.bin",
    ])
      expect(resources.some((url) => url.endsWith(`/${leaf}`))).toBe(true);
  }
  expect(resources.some((url) => url.endsWith("/rift-billboards.json"))).toBe(
    true,
  );
  expect(
    resources.some((url) => /\/recorded-particles\.json(?:\.gz)?$/.test(url)),
  ).toBe(false);
  const vision = page.getByRole("combobox", { name: "Unit visibility" });
  const expectDraws = async (family: string, draws: number) => {
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) => globalThis.recordedRiftTextures.frame.families[id] ?? 0,
            family,
          ),
        { message: `Expected ${String(draws)} ${family} draws.` },
      )
      .toBe(draws);
  };
  await vision.selectOption("all");
  // Fixed UI-clock samples from the native placements and emitter lifetimes.
  const cues: [string, number, number, number, number][] = [
    ["senna-w-ground-impact-flare", 110.6, 110.7, 110.8, 2],
    ["senna-w-ground-impact-flare", 993.7, 993.8, 994, 2],
    ["senna-soul-death", 254.8, 254.9, 255.3, 1],
    ["heimerdinger-w-impact", 1715.5, 1715.7, 1716, 10],
    ["heimerdinger-q-ammo-spend", 1715.7, 1715.8, 1716.4, 1],
    ["kaisa-e-activation", 1718.8, 1719, 1719.2, 1],
  ];
  if (groundPath !== undefined)
    cues.push(["maokai-e-ground-glow", 1714.7, 1715, 1715.4, 1]);
  if (hasRibbons) cues.push(["maokai-r-trails", 1713.9, 1714.3, 1718.5, 5]);
  for (const [family, before, active, expired, draws] of cues) {
    await seek(page, before);
    await expectDraws(family, 0);
    await seek(page, active);
    await expectDraws(family, draws);
    await seek(page, expired);
    await expectDraws(family, 0);
    await seek(page, active);
    await expectDraws(family, draws);
    await vision.selectOption("blue");
    await expectDraws(family, 0);
    await vision.selectOption("all");
    await expectDraws(family, draws);
  }
}
