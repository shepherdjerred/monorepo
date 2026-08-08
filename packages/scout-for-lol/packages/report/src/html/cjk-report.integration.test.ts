import { expect, setDefaultTimeout, test } from "bun:test";
import { matchToSvg, svgToPng } from "#src/html/index.tsx";
import { rankedFixture } from "#src/html/shared/test-fixtures.ts";

setDefaultTimeout(120_000);

test("ranked report renders CJK player names in SVG and PNG", async () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 5,
    outcome: "Victory",
    commentary: "CJK names render in the complete Scout report.",
  });
  const names = [
    "한국어 플레이어",
    "中文玩家",
    "日本語プレイヤー",
    "召喚士勇者",
    "勝利の戦士",
  ];

  match.players.forEach((player, index) => {
    const name = names[index];
    if (name === undefined) {
      throw new Error("Missing CJK fixture name");
    }
    player.playerConfig.alias = name;
    player.champion.riotIdGameName = name;
  });

  const svg = await matchToSvg(match, { designOverride: "square" });
  expect(svg).toContain("<path");

  const png = await svgToPng(svg);
  expect(Buffer.from(png).subarray(0, 8).toString("hex")).toBe(
    "89504e470d0a1a0a",
  );
  expect(png.byteLength).toBeGreaterThan(100_000);
});
