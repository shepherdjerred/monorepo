import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  freezeChallengeCatalogs,
  WIN_EVERY_CURRENT_CHAMPION_TEMPLATE,
} from "@scout-for-lol/data";
import { ChallengeProgress } from "#src/components/challenge/challenge-progress.tsx";
import { championCoverageFromDistinct } from "#src/components/challenge/challenge-champion-coverage.tsx";

const AATROX = { value: "266", label: "Aatrox" };
const AHRI = { value: "103", label: "Ahri" };

describe("championCoverageFromDistinct", () => {
  test("sorts known champion ids A–Z and marks completion", () => {
    expect(
      championCoverageFromDistinct({
        covered: [AHRI],
        missing: [AATROX],
      }),
    ).toEqual([
      { id: 266, label: "Aatrox", completed: false },
      { id: 103, label: "Ahri", completed: true },
    ]);
  });

  test("leaves role and queue labels on the name list", () => {
    expect(
      championCoverageFromDistinct({
        covered: [{ value: "MIDDLE", label: "Mid" }],
        missing: [{ value: "TOP", label: "Top" }],
      }),
    ).toBeNull();
  });

  test("rejects unknown numeric champion ids instead of listing names", () => {
    expect(() =>
      championCoverageFromDistinct({
        covered: [],
        missing: [{ value: "999999", label: "Not a champion" }],
      }),
    ).toThrow("Unknown champion id 999999");
  });
});

describe("ChallengeProgress", () => {
  test("renders champion portraits with grayscale only on remaining", () => {
    const html = renderToStaticMarkup(
      <ChallengeProgress
        progress={{
          kind: "distinct",
          current: 1,
          target: 2,
          covered: [AHRI],
          missing: [AATROX],
          completed: false,
        }}
      />,
    );
    expect(html).toContain('alt="Ahri, completed"');
    expect(html).toContain('alt="Aatrox, remaining"');
    expect(html).toContain('title="Ahri"');
    expect(html).toContain('title="Aatrox"');
    expect(html).toMatch(
      /class="[^"]*grayscale[^"]*"[^>]*alt="Aatrox, remaining"/,
    );
    expect(html).not.toMatch(
      /class="[^"]*grayscale[^"]*"[^>]*alt="Ahri, completed"/,
    );
    expect(html).not.toContain("Missing:");
    expect(html).toContain("1 / 2");
  });

  test("renders a portrait for every frozen current-champion catalog entry", () => {
    const frozen = freezeChallengeCatalogs(WIN_EVERY_CURRENT_CHAMPION_TEMPLATE);
    expect(frozen.progressGoal.kind).toBe("distinct");
    if (frozen.progressGoal.kind !== "distinct") return;
    const [first, ...rest] = frozen.progressGoal.requiredValues;
    if (first === undefined) {
      throw new Error("Frozen champion catalog has no required values");
    }
    const html = renderToStaticMarkup(
      <ChallengeProgress
        progress={{
          kind: "distinct",
          current: 1,
          target: frozen.progressGoal.requiredValues.length,
          covered: [first],
          missing: rest,
          completed: false,
        }}
      />,
    );
    expect(html.match(/<img /g)?.length).toBe(
      frozen.progressGoal.requiredValues.length,
    );
    expect(html).toContain("/img/champion/");
    expect(html).toContain("grayscale");
  });

  test("still lists missing role names", () => {
    const html = renderToStaticMarkup(
      <ChallengeProgress
        progress={{
          kind: "distinct",
          current: 1,
          target: 2,
          covered: [{ value: "MIDDLE", label: "Mid" }],
          missing: [{ value: "JUNGLE", label: "Jungle" }],
          completed: false,
        }}
      />,
    );
    expect(html).toContain("Missing: Jungle");
    expect(html).not.toContain("<img");
  });
});
