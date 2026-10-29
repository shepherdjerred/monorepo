import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { overlayRwf } from "#e2e/harness/config-overlays.ts";
import { rwfTestSettings } from "#e2e/harness/rwf-settings.ts";
import { authoredCombatMatch, trooperCombatProfile } from "./profile.ts";

const experience: ReturnType<typeof trooperCombatProfile>["original"] = {
  difficulty: "hard",
  style: "varied",
  variety: "high",
  maps: [],
  kits: [],
};
test("private initial Trooper pool preserves required authored baseline and unrelated configuration", () => {
  const source = {
    experience,
    worlds: { maps: "rwf" },
    match: { targetCombatants: 256 },
  };
  const staged = trooperCombatProfile(source);
  expect(staged.configuration).toEqual({
    ...source,
    experience: { ...experience, kits: ["trooper"] },
  });
  expect(staged.original).toEqual(experience);
  expect(source.experience.kits).toEqual([]);
});
test("a missing, unknown or different required experience fails instead of inventing defaults", () => {
  for (const raw of [
    {},
    { experience: { ...experience, difficulty: "normal" } },
    { experience: { ...experience, extra: true } },
    { experience: { ...experience, kits: undefined } },
  ])
    expect(() => trooperCombatProfile(raw)).toThrow();
});

test("serialized private profile remains compatible with actual ordinary server staging overlays", async () => {
  const source = await Bun.file(
    path.join(
      import.meta.dirname,
      "../../../server/owned/plugins/TheStorm/rwf.yml",
    ),
  ).text();
  const staged = trooperCombatProfile(Bun.YAML.parse(source));
  const directory = await mkdtemp(
    path.join(tmpdir(), "rwf-authored-profile-test-"),
  );
  try {
    const file = path.join(directory, "rwf.yml");
    await Bun.write(file, staged.text);
    await overlayRwf(file, {
      ...rwfTestSettings,
      targetCombatants: 2,
      maxCombatants: 2,
      automaticSizing: false,
    });
    const parsed = z
      .looseObject({
        worlds: z.looseObject({ maps: z.literal("rwf") }),
        experience: z.looseObject({ kits: z.array(z.string()) }),
        match: z.looseObject({
          targetCombatants: z.literal(2),
          maxCombatants: z.literal(2),
          automaticSizing: z.literal(false),
          countdown: z.literal("PT6S"),
        }),
      })
      .parse(Bun.YAML.parse(await Bun.file(file).text()));
    expect(parsed.experience.kits).toEqual(["trooper"]);
    await overlayRwf(file, { ...rwfTestSettings, ...authoredCombatMatch });
    const observed = z
      .looseObject({
        match: z.looseObject({
          countdown: z.literal("PT15S"),
          endLinger: z.literal("PT30S"),
          previewLength: z.string(),
          freezeLength: z.string(),
          targetCombatants: z.literal(2),
          maxCombatants: z.literal(2),
          automaticSizing: z.literal(false),
        }),
      })
      .parse(Bun.YAML.parse(await Bun.file(file).text()));
    expect(observed.match.previewLength).toBe(rwfTestSettings.previewLength);
    expect(observed.match.freezeLength).toBe(rwfTestSettings.freezeLength);
    expect(trooperCombatProfile(Bun.YAML.parse(source)).original.kits).toEqual(
      staged.original.kits,
    );
    await Bun.write(
      file,
      staged.text.replace(/^worlds:[\t ]*$/mu, "missing-worlds:"),
    );
    await expect(overlayRwf(file, rwfTestSettings)).rejects.toThrow(
      "No worlds section to overlay",
    );
    await Bun.write(file, staged.text.replace(/^ {2}maxCombatants:.*$/mu, ""));
    await expect(
      overlayRwf(file, { ...rwfTestSettings, maxCombatants: 2 }),
    ).rejects.toThrow("No match.maxCombatants line to overlay");
  } finally {
    await rm(directory, { recursive: true });
  }
});
