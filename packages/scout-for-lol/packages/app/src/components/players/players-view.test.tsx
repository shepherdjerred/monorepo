import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import {
  PlayersView,
  type SearchState,
} from "#src/components/players/players-view.tsx";
import { NOW_MS } from "#src/lib/player/player-fixtures.ts";
import {
  GUILDS,
  LIVE_GAME,
  MIDNIGHT_SCRIMS,
  rosterPlayer,
} from "#src/lib/players/roster-fixtures.ts";
import type { Roster } from "#src/lib/players/roster-page.ts";

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

function NOOP(): void {
  // A handler the test never fires.
}

function view(
  roster: Roster,
  options: {
    guildIds?: DiscordGuildId[];
    search?: SearchState;
  } = {},
): string {
  return render(
    <PlayersView
      roster={roster}
      guildIds={options.guildIds}
      onGuildIds={NOOP}
      find=""
      onFind={NOOP}
      search={options.search ?? { kind: "idle" }}
      nowMs={NOW_MS}
    />,
  );
}

const PEOPLE = [
  rosterPlayer(1, "RiverQuartz", { live: LIVE_GAME }),
  rosterPlayer(2, "TidalWren"),
  rosterPlayer(3, "Northstar", {
    isYou: true,
    rank: {
      solo: { tier: "emerald", division: 2, lp: 64, wins: 1, losses: 1 },
      flex: null,
    },
    form: {
      games: 20,
      wins: 12,
      streak: { result: "win", games: 3, atLeast: false },
    },
  }),
];

describe("PlayersView", () => {
  const roster: Roster = { guilds: GUILDS, players: PEOPLE };

  test("the hero says who is in a game, and has a real search", () => {
    const html = view(roster);
    expect(html).toContain("<h1");
    expect(html).toContain("RiverQuartz is playing right now.");
    expect(html).toContain("As Ahri in Ranked Solo.");
    expect(html).toContain('role="search"');
    expect(html).toContain("Find a player");
  });

  test("friends are rows with the latest game and rank, the live one marked", () => {
    const html = view(roster);
    expect(html).toContain("Your friends");
    expect(html).toContain("In a game now, as Ahri");
    expect(html).toContain("Lost as Thresh, 2 hours ago");
    expect(html).toContain("Platinum");
    expect(html).toContain('href="/players/2"');
    expect(html).toContain('aria-label="Which servers to include"');
  });

  test("You is its own panel with the record, and is not listed among the friends", () => {
    const html = view(roster);
    expect(html).toContain(">You<");
    expect(html).toContain(
      "Won 12 of the last 20, and on a 3-game win streak.",
    );
    expect(html).toContain("Open your profile");
    expect(html).toContain('href="/players/3"');
    expect(html.match(/<b>Northstar<\/b>/g) ?? []).toHaveLength(0);
  });

  test("a server chosen leaves out people who are not in it", () => {
    const html = view(
      {
        guilds: GUILDS,
        players: [
          rosterPlayer(1, "Rift"),
          rosterPlayer(2, "Midnight", {
            memberships: [
              {
                playerId: rosterPlayer(2, "x").playerId,
                guild: { id: MIDNIGHT_SCRIMS, name: "Midnight Scrims" },
              },
            ],
          }),
        ],
      },
      { guildIds: [MIDNIGHT_SCRIMS] },
    );
    expect(html).toContain("Midnight");
    expect(html).not.toContain(">Rift<");
  });

  test("only eight friends show until See all", () => {
    const many: Roster = {
      guilds: GUILDS,
      players: Array.from({ length: 11 }, (_, index) =>
        rosterPlayer(index + 1, `Friend${(index + 1).toString()}`),
      ),
    };
    const html = view(many);
    expect(html.match(/scout-friend-row"/g) ?? []).toHaveLength(8);
    expect(html).toContain("See all 11");
  });

  test("with nobody in a game the hero states the week", () => {
    const html = view({
      guilds: GUILDS,
      players: [rosterPlayer(1, "A"), rosterPlayer(2, "B")],
    });
    expect(html).toContain("2 of 2 played this week.");
  });

  test("a search replaces the friends with its results", () => {
    const found = view(roster, {
      search: { kind: "found", players: [PEOPLE[1] ?? rosterPlayer(9, "?")] },
    });
    expect(found).toContain("Results");
    expect(found).toContain("TidalWren");
    expect(found).not.toContain("Your friends");
    const none = view(roster, { search: { kind: "found", players: [] } });
    expect(none).toContain("No players found");
    const loading = view(roster, { search: { kind: "loading" } });
    expect(loading).toContain("Searching…");
    const failed = view(roster, {
      search: { kind: "failed", onRetry: NOOP },
    });
    expect(failed).toContain("Search could not finish.");
    expect(failed).toContain("Retry");
  });

  test("an empty roster is one plain state", () => {
    const html = view({ guilds: GUILDS, players: [] });
    expect(html).toContain("No players yet");
    expect(html).not.toContain('role="search"');
  });
});
