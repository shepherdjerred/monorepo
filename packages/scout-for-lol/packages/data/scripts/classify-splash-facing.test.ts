import { describe, expect, test } from "vitest";
import type { ChampionSplashFacingEntry } from "#src/data-dragon/champion-splash-facing.ts";
import {
  buildFacingPrompt,
  planSplashFacing,
  type SplashFile,
} from "./classify-splash-facing.ts";

const entry = (imageSha256: string): ChampionSplashFacingEntry => ({
  facing: "right",
  focusX: 0.5,
  mirrorSafe: true,
  imageSha256,
  source: "model",
  confidence: "high",
  note: "",
});
const splash = (championKey: string, imageSha256: string): SplashFile => ({
  file: `${championKey}_0.jpg`,
  championKey,
  imageSha256,
});

describe("planSplashFacing", () => {
  test("skips splashes whose sha256 already has an entry", () => {
    const plan = planSplashFacing(
      { version: 1, entries: { "Ahri_0.jpg": entry("a".repeat(64)) } },
      [splash("Ahri", "a".repeat(64))],
    );
    expect(plan.pending).toEqual([]);
    expect(Object.keys(plan.keep)).toEqual(["Ahri_0.jpg"]);
  });

  test("classifies new splashes and splashes whose image changed", () => {
    const plan = planSplashFacing(
      { version: 1, entries: { "Ahri_0.jpg": entry("a".repeat(64)) } },
      [splash("Ahri", "b".repeat(64)), splash("Syndra", "c".repeat(64))],
    );
    expect(plan.pending.map((item) => item.file)).toEqual([
      "Ahri_0.jpg",
      "Syndra_0.jpg",
    ]);
    expect(plan.keep).toEqual({});
  });

  test("prunes entries for splashes that no longer exist", () => {
    const plan = planSplashFacing(
      {
        version: 1,
        entries: {
          "Ahri_0.jpg": entry("a".repeat(64)),
          "Gone_0.jpg": entry("d".repeat(64)),
        },
      },
      [splash("Ahri", "a".repeat(64))],
    );
    expect(plan.pruned).toEqual(["Gone_0.jpg"]);
    expect(Object.keys(plan.keep)).toEqual(["Ahri_0.jpg"]);
  });
});

describe("buildFacingPrompt", () => {
  test("names the champion and flags League Classic art", () => {
    expect(
      buildFacingPrompt({ championName: "Ahri", classic: false }),
    ).toContain("champion Ahri.");
    expect(
      buildFacingPrompt({ championName: "Ahri", classic: true }),
    ).toContain("League Classic era art");
  });
});
