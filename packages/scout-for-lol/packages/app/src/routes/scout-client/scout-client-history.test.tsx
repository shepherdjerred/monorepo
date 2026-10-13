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
