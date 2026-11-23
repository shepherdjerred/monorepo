import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ReplayPageView } from "./replay-page-view.tsx";
import { ReplayAnalysis } from "./replay-analysis.tsx";
import { replayFixture } from "#src/lib/replay/replay-fixture.ts";
import { ReplayControls } from "./replay-controls.tsx";
import { ReplayRosterScore, ReplayTeamScore } from "./replay-scoreboard.tsx";
import type { ReplaySessionState } from "@scout-for-lol/replay";

test("the replay scoreboard hides unknown coverage and preserves observed zeroes", () => {
  const scoreboard = {
    blueKills: 0,
    redKills: null,
    winningTeam: null,
    players: [
      { participantId: 1, kills: 0, deaths: null, assists: null, level: 3 },
      {
        participantId: 2,
        kills: null,
        deaths: null,
        assists: null,
        level: null,
      },
    ],
  };
  const participants = [
    {
      participantId: 1,
      teamId: 100,
      name: "Blue player",
      championName: "Lulu",
    },
    {
      participantId: 2,
      teamId: 200,
      name: "Red player",
      championName: "Diana",
    },
  ] satisfies ReplaySessionState["participants"];

  const score = renderToStaticMarkup(
    <ReplayTeamScore scoreboard={scoreboard} />,
  );
  expect(score).toContain("Blue team");
  expect(score).toMatch(/>0<\/span><span[^>]*>kills/);
  expect(score).not.toContain("Red team");
  expect(score).not.toContain("won");
  expect(score).not.toContain("aria-live");

  const roster = renderToStaticMarkup(
    <ReplayRosterScore participants={participants} scoreboard={scoreboard} />,
  );
  expect(roster).toContain("Blue player");
  expect(roster).toContain("Level");
  expect(roster).toMatch(/>3<\/td>/);
  expect(roster).not.toContain("Deaths");
  expect(roster).not.toContain("Assists");
  expect(roster).not.toContain("Red player");
});

test("the replay HUD shows a result only when the session supplies a winner", () => {
  const scoreboard = {
    blueKills: null,
    redKills: null,
    winningTeam: null,
    players: [],
  };
  expect(
    renderToStaticMarkup(<ReplayTeamScore scoreboard={scoreboard} />),
  ).toBe("");
  const finished = renderToStaticMarkup(
    <ReplayTeamScore scoreboard={{ ...scoreboard, winningTeam: 200 }} />,
  );
  expect(finished).toContain("Red team won");
  expect(finished).not.toContain("kills");
});

test("the replay slider reserves an input tick for a fractional terminal time", () => {
  const state: ReplaySessionState = {
    timeSeconds: 1757.162,
    durationSeconds: 1757.163,
    playing: false,
    rate: 1,
    perspective: "all",
    camera: { mode: "free" },
    participants: [],
  };
  const onCommand = vi.fn().mockResolvedValue(undefined);
  const beforeEnd = renderToStaticMarkup(
    <ReplayControls state={state} onCommand={onCommand} />,
  );
  const terminal = renderToStaticMarkup(
    <ReplayControls
      state={{ ...state, timeSeconds: state.durationSeconds }}
      onCommand={onCommand}
    />,
  );
  expect(beforeEnd).toMatch(/<input[^>]*max="1757.2"[^>]*value="1757.1"\//);
  expect(terminal).toMatch(/<input[^>]*max="1757.2"[^>]*value="1757.2"\//);
});

test("stored but unadmitted replays explain availability without a blank player or sign-in gate", () => {
  const html = renderToStaticMarkup(
    <ReplayPageView state={{ status: "loaded", replay: replayFixture }} />,
  );
  expect(html).toContain("Replay playback is being prepared");
  expect(html).toContain("16.21.829.8620");
  expect(html).not.toContain("<canvas");
  expect(html).not.toContain("Sign in");
  expect(html).not.toContain("Play</button>");
});

test("loading and missing replays have readable status and retry states", () => {
  const loading = renderToStaticMarkup(
    <ReplayPageView state={{ status: "loading" }} />,
  );
  expect(loading).toContain('role="status"');
  expect(loading).toContain("Loading replay");
  const missing = renderToStaticMarkup(
    <ReplayPageView
      state={{ status: "error", message: "This replay is not available." }}
      onRetry={vi.fn()}
    />,
  );
  expect(missing).toContain('role="alert"');
  expect(missing).toContain("Try again");
});

test("analysis restores a shared event timestamp while playback is unadmitted", () => {
  const html = renderToStaticMarkup(
    <ReplayPageView
      state={{ status: "loaded", replay: replayFixture }}
      analysis={
        <ReplayAnalysis
          durationSeconds={60}
          search="?t=75.125"
          state={{
            status: "ready",
            timeline: {
              source: "riot_match_timeline",
              events: [
                {
                  id: 1,
                  timestampMs: 75_125,
                  type: "GAME_END",
                  objective: null,
                  teamId: 100,
                },
              ],
            },
          }}
        />
      }
    />,
  );
  expect(html).toContain("Replay playback is being prepared");
  expect(html).toContain("Key events from Riot’s match timeline.");
  expect(html).toContain('aria-valuetext="1:15"');
  expect(html).toContain('max="75125"');
  expect(html).toContain('value="75125"');
  expect(html).toContain('aria-current="time"');
  expect(html).toContain("Blue team won");
  expect(html).toContain("Copy timestamp link");
  expect(html).toContain("Play timeline");
  expect(html).toContain("Timeline speed");
});

test("a shared position between events restores the preceding recorded event and exact clock", () => {
  const html = renderToStaticMarkup(
    <ReplayAnalysis
      durationSeconds={60}
      search="?t=54.375"
      state={{
        status: "ready",
        timeline: {
          source: "riot_match_timeline",
          events: [
            {
              id: 1,
              timestampMs: 52_500,
              type: "BUILDING_KILL",
              objective: "OUTER_TURRET",
              teamId: null,
            },
            {
              id: 2,
              timestampMs: 60_000,
              type: "GAME_END",
              objective: null,
              teamId: 100,
            },
          ],
        },
      }}
    />,
  );
  expect(html).toContain('value="54375"');
  expect(html).toContain("Latest event at 0:52");
  expect(html).toMatch(/aria-current="time"[^>]*>.*Outer turret destroyed/);
});

test("older-patch and metadata states do not claim playable content", () => {
  const old = renderToStaticMarkup(
    <ReplayPageView
      state={{
        status: "loaded",
        replay: {
          ...replayFixture,
          playback: {
            status: "incompatible",
            reason: "older_patch",
            latestPatch: "16.22",
          },
        },
      }}
    />,
  );
  expect(old).toContain("older patch");
  const pending = renderToStaticMarkup(
    <ReplayPageView
      state={{
        status: "loaded",
        replay: { ...replayFixture, playback: { status: "metadata_pending" } },
      }}
    />,
  );
  expect(pending).toContain("Replay is being checked");
  expect(pending).not.toContain("<canvas");
});

test("only admitted playback renders the supplied player", () => {
  const html = renderToStaticMarkup(
    <ReplayPageView
      state={{
        status: "loaded",
        replay: {
          ...replayFixture,
          playback: {
            status: "available",
            latestPatch: "16.21",
            package: {
              url: "/replay-assets/build/manifest.json",
              sha256: "b".repeat(64),
            },
          },
        },
      }}
    >
      <p>Mounted engine</p>
    </ReplayPageView>,
  );
  expect(html).toContain("Mounted engine");
  expect(html).not.toContain("being prepared");
});

test("explicit research controls omit capabilities that the partial engine does not implement", () => {
  const state: ReplaySessionState = {
    timeSeconds: 79,
    durationSeconds: 120,
    playing: false,
    rate: 1,
    perspective: "all",
    camera: { mode: "free" },
    participants: [
      {
        participantId: 1,
        name: "Example player",
        championName: "Akshan",
        teamId: 100,
      },
    ],
  };
  const onCommand = vi.fn().mockResolvedValue(undefined);
  const partial = renderToStaticMarkup(
    <ReplayControls
      state={state}
      onCommand={onCommand}
      controls={{
        rates: [0.5, 1, 2, 4],
        perspectives: ["all"],
        directedCamera: false,
      }}
    />,
  );
  expect(partial).toContain('value="4"');
  expect(partial).toContain("Example player");
  expect(partial).not.toContain('value="8"');
  expect(partial).not.toContain('value="0.25"');
  expect(partial).not.toContain("Directed camera");
  expect(partial).not.toContain("Blue team");
  const native = renderToStaticMarkup(
    <ReplayControls state={state} onCommand={onCommand} />,
  );
  expect(native).toContain("Directed camera");
  expect(native).toContain("Blue team");
  expect(native).toContain('value="8"');
});
