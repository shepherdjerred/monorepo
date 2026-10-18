import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ScoutClientHistoryView } from "./scout-client-history.tsx";
import { recoveredGamesFixture } from "./scout-client-history.fixture.ts";

test("recovered scoreboards distinguish missing stats from zero and withhold conflicting outcomes", () => {
  const html = renderToStaticMarkup(
    <ScoutClientHistoryView data={recoveredGamesFixture} />,
  );
  expect(html).toContain("0 / — / 2");
  expect(html).toContain("Unknown player");
  expect(html).toContain("Result unresolved");
  expect(html).toContain("Scoreboard for NA1_7101");
  expect(html).not.toContain("Scoreboard for NA1_7102");
});

test("terminal scoreboards use their observed completion time when lobby creation is absent", () => {
  const completedAt = Date.parse("2026-10-18T04:06:53Z");
  const data = {
    ...recoveredGamesFixture,
    results: recoveredGamesFixture.results.map((game) => ({
      ...game,
      gameCreation: null,
      completedAt,
      participants: game.participants.map((player) => ({
        ...player,
        participantId: null,
      })),
    })),
  };
  const html = renderToStaticMarkup(<ScoutClientHistoryView data={data} />);
  expect(html).toContain(new Date(completedAt).toLocaleString());
  expect(html).not.toContain("1970");
});
