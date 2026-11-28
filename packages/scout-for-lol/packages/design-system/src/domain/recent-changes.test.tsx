import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  getRecentChampionChanges,
  patchChanges,
} from "@scout-for-lol/data/data-dragon/patch-changes.ts";
import {
  changeDetail,
  changeLabel,
  formatPatchAge,
  isMixedPatch,
  RecentChanges,
} from "./recent-changes.tsx";

const KAYLE = 10;
const LEBLANC = 7;
const NASUS = 75;
const DORANS_BOW = 1086;
const OVERLORDS_BLOODMAIL = 2501;
const now = new Date("2026-11-27T12:00:00Z");

const kayle = getRecentChampionChanges({
  championId: KAYLE,
  patches: 10,
  itemIds: [DORANS_BOW, OVERLORDS_BLOODMAIL],
});

describe("formatPatchAge", () => {
  test("counts days, weeks, months and years back from now", () => {
    expect(formatPatchAge("2026-11-27", now)).toBe("today");
    expect(formatPatchAge("2026-11-26", now)).toBe("yesterday");
    expect(formatPatchAge("2026-11-17", now)).toBe("last week");
    expect(formatPatchAge("2026-11-03", now)).toBe("3 weeks ago");
    expect(formatPatchAge("2026-07-01", now)).toBe("4 months ago");
    expect(formatPatchAge("2024-01-01", now)).toBe("2 years ago");
  });
});

describe("row text", () => {
  test("names the ability, the item or the base stat", () => {
    expect(kayle[0]?.changes.map((change) => changeLabel(change))).toEqual([
      "Radiant Blast",
      "Divine Judgment",
      "Doran's Bow",
      "Overlord's Bloodmail",
      "Overlord's Bloodmail",
    ]);
    expect(kayle[0]?.changes.map((change) => changeDetail(change))).toEqual([
      "Cooldown",
      "Cooldown",
      "Attack Damage",
      "Attack Damage",
      "Retribution",
    ]);
    const leblanc = getRecentChampionChanges({
      championId: LEBLANC,
      patches: 10,
    }).find((patch) => patch.patch === "26.17");
    expect(
      leblanc?.changes.map((change) => changeLabel(change)).slice(0, 2),
    ).toEqual(["Base stats", "Base stats"]);
  });
});

describe("isMixedPatch", () => {
  test("is true when a row moves differently from the champion's direction", () => {
    expect(isMixedPatch(kayle[0] ?? throwMissing())).toBe(true);
  });

  test("is false when every row agrees", () => {
    const plain = getRecentChampionChanges({ championId: KAYLE, patches: 10 });
    expect(isMixedPatch(plain[0] ?? throwMissing())).toBe(false);
  });
});

function throwMissing(): never {
  throw new Error("Expected a patch group");
}

describe("RecentChanges", () => {
  test("every line in the notes resolves to an icon", () => {
    const championIds = new Set(
      patchChanges.flatMap((line) =>
        line.subject.kind === "champion" ? [line.subject.id] : [],
      ),
    );
    const itemIds = patchChanges.flatMap((line) =>
      line.subject.kind === "item" ? [line.subject.id] : [],
    );
    for (const championId of championIds) {
      const patches = getRecentChampionChanges({
        championId,
        patches: 10,
        itemIds,
      });
      const html = renderToStaticMarkup(
        <RecentChanges patches={patches} championId={championId} now={now} />,
      );
      expect(html.match(/<img /g)?.length).toBe(
        patches.reduce((total, patch) => total + patch.changes.length, 0),
      );
    }
  });

  test("writes every row as Was ... now ... with the data's own units", () => {
    const html = renderToStaticMarkup(
      <RecentChanges patches={kayle} championId={KAYLE} now={now} />,
    );
    expect(html).toContain(
      '<span class="scout-recent-changes__was">Was 12 / 11 / 10 / 9 / 8s</span> now <b class="scout-recent-changes__now">10 / 9.5 / 9 / 8.5 / 8s</b>',
    );
    expect(html).toContain(
      '<span class="scout-recent-changes__was">Was 8</span> now <b class="scout-recent-changes__now">7</b>',
    );
    expect(html).not.toContain("seconds");
    expect(html).not.toContain("__then");
    expect(html.match(/scout-recent-changes__values/g)).toHaveLength(5);
  });

  test("a mixed patch marks every row and a plain patch marks none", () => {
    const mixed = renderToStaticMarkup(
      <RecentChanges patches={kayle} championId={KAYLE} now={now} />,
    );
    expect(mixed).toContain("scout-recent-changes__mark");
    expect(mixed.match(/scout-recent-changes__mark"/g)).toHaveLength(5);
    expect(mixed).toContain("Buffed");
    expect(mixed).toContain("Nerfed");

    const plain = renderToStaticMarkup(
      <RecentChanges
        patches={getRecentChampionChanges({ championId: KAYLE, patches: 10 })}
        championId={KAYLE}
        now={now}
      />,
    );
    expect(plain).not.toContain("scout-recent-changes__mark");
  });

  test("shows the win rate before and after only for the patch it is given", () => {
    const html = renderToStaticMarkup(
      <RecentChanges
        patches={kayle}
        championId={KAYLE}
        now={now}
        winRates={{
          "26.22": {
            before: { winRate: 50.9, games: 11_900 },
            after: { winRate: 51.8, games: 12_480 },
          },
        }}
      />,
    );
    expect(html).toContain("<b>51.8%</b> of 12,480 games");
    expect(html).toContain("<b>50.9%</b> of 11,900");
    expect(
      renderToStaticMarkup(
        <RecentChanges patches={kayle} championId={KAYLE} now={now} />,
      ),
    ).not.toContain("games since");
  });

  test("hands each row's label to the render prop", () => {
    const html = renderToStaticMarkup(
      <RecentChanges
        patches={kayle}
        championId={KAYLE}
        now={now}
        renderAbilityLabel={({ label }) => <em data-slot="ability">{label}</em>}
      />,
    );
    expect(html).toContain('<em data-slot="ability">Radiant Blast</em>');
  });

  test("renders an empty state without a list or a link", () => {
    const html = renderToStaticMarkup(
      <RecentChanges
        patches={getRecentChampionChanges({ championId: NASUS, patches: 3 })}
        championId={NASUS}
        windowPatches={3}
        allChangesHref="/changes"
        now={now}
      />,
    );
    expect(html).toContain("No changes in the last 3 patches");
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("See all changes");
  });

  test("links to every change when the patches are shown", () => {
    const html = renderToStaticMarkup(
      <RecentChanges
        patches={kayle}
        championId={KAYLE}
        allChangesHref="/changes"
        now={now}
      />,
    );
    expect(html).toContain('href="/changes"');
  });
});
