import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { ReplayMatchLink } from "#src/components/replay/replay-match-link.tsx";
import { matchReplayQuery } from "#src/lib/replay/api.ts";
import { replayFixture } from "#src/lib/replay/replay-fixture.ts";
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

test("a completed upload remains discoverable from a conflicted result", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(matchReplayQuery("NA1_7102").queryKey, {
    replay: { ...replayFixture, matchId: "NA1_7102", gameId: "7102" },
  });
  const html = renderToStaticMarkup(
    <MemoryRouter basename="/app" initialEntries={["/app/scout-client"]}>
      <QueryClientProvider client={queryClient}>
        <ScoutClientHistoryView
          data={recoveredGamesFixture}
          replayLink={(matchId) => <ReplayMatchLink matchId={matchId} />}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(html).toContain("Result unresolved");
  expect(html).not.toContain("Scoreboard for NA1_7102");
  expect(html).toContain(`href="/app/replays/${replayFixture.replayId}"`);
  expect(html).toContain("View replay</a>");
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
