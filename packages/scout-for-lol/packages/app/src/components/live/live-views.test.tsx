import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { LiveGameView } from "#src/components/live/live-game-view.tsx";
import { LiveListView } from "#src/components/live/live-list-view.tsx";
import {
  LiveGameGone,
  LiveUnavailable,
} from "#src/components/live/live-shell.tsx";
import {
  LIVE_NOW,
  liveGameFixture,
  liveListFixture,
  twoFriendsFixture,
} from "#src/lib/live/live-fixtures.ts";
import type { LiveGameData } from "#src/lib/live/live-game.ts";

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
}

function text(html: string): string {
  return html
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll(/\s+/g, " ");
}

function game(overrides?: Partial<LiveGameData>): string {
  return render(
    <LiveGameView game={liveGameFixture(overrides)} now={LIVE_NOW} />,
  );
}

describe("LiveGameView", () => {
  test("opens on who is playing what, and for how long", () => {
    const words = text(game());
    expect(words).toContain("RiverQuartz");
    expect(words).toContain("In a game now");
    expect(words).toContain(
      "Playing Ahri in mid against Syndra, 6 minutes in.",
    );
    expect(words).toContain("A Ranked Solo game.");
  });

  test("lists both teams with the friend marked and linked", () => {
    const html = game();
    const words = text(html);
    expect(words).toContain("RiverQuartz's team");
    expect(words).toContain("Their team");
    expect(words).toContain("Ironbark#NA1");
    expect(words).toContain("Oddfellow#NA1");
    expect(words).toContain("Friend");
    expect(html).toContain('href="/players/7"');
    // Ten players, ten champion faces in the lobby rows.
    expect(html.match(/scout-face__image/g)?.length).toBeGreaterThanOrEqual(10);
  });

  test("shows a rank where one is known and none where it is not", () => {
    const words = text(game());
    expect(words).toContain("Emerald III");
    expect(words).toContain("Platinum I");
    // A stranger's rank is the one read since detection.
    expect(words).toContain("Emerald I");
    expect(words).not.toContain("Unranked");
  });

  test("draws each player's spells and keystone", () => {
    const html = game();
    expect(html.match(/alt="Flash"/g)).toHaveLength(10);
    expect(html).toContain('alt="Electrocute"');
    expect(html).toContain('alt="Conqueror"');
  });

  test("says who to watch, and that it updates when the game ends", () => {
    const words = text(game());
    expect(words).toContain("Who to watch");
    expect(words).toContain("Their jungler, Hushwing , has won 5 in a row.");
    expect(words).toContain("Updates when the game ends.");
  });

  test("leaves the watch section out when nothing was read", () => {
    const quiet = liveGameFixture();
    const words = text(
      render(
        <LiveGameView
          now={LIVE_NOW}
          game={{
            ...quiet,
            participants: quiet.participants.map((participant) => ({
              ...participant,
              recentForm: null,
            })),
          }}
        />,
      ),
    );
    expect(words).not.toContain("Who to watch");
  });

  test("a game that is over says so and stops promising an update", () => {
    const words = text(game({ ended: true }));
    expect(words).toContain("Game over");
    expect(words).toContain("Played Ahri in mid against Syndra.");
    expect(words).not.toContain("Updates when the game ends.");
  });

  test("names the champion in the friend's panel, with a way to their profile", () => {
    const html = game();
    expect(text(html)).toContain("RiverQuartz on Ahri");
    expect(text(html)).toContain("See profile");
    expect(text(html)).toContain("Emerald I");
  });

  test("two friends share a panel of rows", () => {
    const html = render(
      <LiveGameView game={twoFriendsFixture()} now={LIVE_NOW} />,
    );
    const words = text(html);
    expect(words).toContain("Friends in this game");
    expect(words).toContain("In a game now, as Garen, top");
    expect(words).toContain("In a game now, as Ahri, mid");
    expect(words).toContain("Quillon and RiverQuartz's game");
  });

  test("never writes a sentence about the page itself", () => {
    const words = text(game());
    for (const narration of [
      "This page",
      "Everyone in the game",
      "sorted",
      "Worked out from",
    ]) {
      expect(words).not.toContain(narration);
    }
  });
});

describe("LiveListView", () => {
  test("names who is playing and links each game to its lobby", () => {
    const html = render(
      <LiveListView games={liveListFixture()} now={LIVE_NOW} />,
    );
    const words = text(html);
    expect(words).toContain(
      "RiverQuartz and 2 friends are in a game right now.",
    );
    expect(words).toContain("Ranked Solo, 6 minutes in");
    expect(words).toContain("ARAM, 1 minute in");
    expect(words).toContain("In a game now, as Ahri in mid");
    expect(html).toContain('href="/live/NA1_5500000777"');
    expect(html).toContain('href="/live/NA1_5500000778"');
    expect(words).toContain("Watch the lobby");
  });

  test("with nobody in a game it says so and lists nothing", () => {
    const html = render(<LiveListView games={[]} now={LIVE_NOW} />);
    expect(text(html)).toContain("No friends are in a game right now.");
    expect(html).not.toContain("/live/");
  });
});

describe("the states around the pages", () => {
  test("an unreadable page offers a retry and a way out", () => {
    const words = text(
      render(
        <LiveUnavailable title="Live games unavailable" onRetry={vi.fn()} />,
      ),
    );
    expect(words).toContain("Live games unavailable");
    expect(words).toContain("Retry");
    expect(words).toContain("Players");
  });

  test("a game that is gone points back to the live list", () => {
    const html = render(<LiveGameGone />);
    expect(text(html)).toContain("This game is no longer available");
    expect(html).toContain('href="/live"');
  });
});
