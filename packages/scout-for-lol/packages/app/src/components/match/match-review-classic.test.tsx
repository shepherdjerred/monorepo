import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { RiotMatchIdSchema } from "@scout-for-lol/data";
import { MatchReview } from "#src/components/match/match-review.tsx";
import type {
  MatchParticipant,
  MatchTeam,
} from "#src/components/match/match-scoreboard.tsx";
import { supportsReviewMap } from "#src/lib/player/match-review.ts";

const objectives = { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 };

function participant(
  championName: string,
  championId: number,
  overrides: Partial<MatchParticipant> = {},
): MatchParticipant {
  return {
    // An end-of-game record numbers no participant.
    participantId: null,
    riotId: { gameName: null, tagLine: null },
    championId,
    championName,
    position: "",
    kills: 3,
    deaths: 2,
    assists: 5,
    creepScore: 120,
    goldEarned: 9000,
    visionScore: 0,
    damageToChampions: 15_000,
    killParticipation: null,
    damageShare: null,
    objectives,
    // Classic spell and item ids, as the end-of-game fixture states them.
    loadout: {
      itemIds: [771_055, 773_109, 0, 0, 0, 0, 773_340],
      summonerSpellIds: [74, 712],
      runes: null,
    },
    ...overrides,
  };
}

const teams: MatchTeam[] = [
  {
    teamId: 100,
    win: true,
    objectives: null,
    participants: [
      participant("Jade_Graves", 60_104),
      participant("Jade_Kayle", 60_010, {
        riotId: { gameName: "Bot Kayle", tagLine: null },
      }),
    ],
  },
  {
    teamId: 200,
    win: false,
    objectives: null,
    participants: [participant("Jade_Ahri", 60_103)],
  },
];

const classicMatch = {
  mapId: 453,
  queueId: 4310,
  gameMode: "JADE",
  gameVersion: null,
  gameDurationSeconds: 1500,
  teams,
  roleMatchups: null,
};

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MatchReview
        source={{ kind: "explore" }}
        matchId={RiotMatchIdSchema.parse("NA1_5663121007")}
        match={classicMatch}
        tally={null}
      />
    </MemoryRouter>,
  );
}

describe("a League Classic match page", () => {
  test("has no Rift map to review", () => {
    expect(supportsReviewMap(classicMatch)).toBe(false);
    expect(render()).not.toContain("summoners-rift");
  });

  test("renders both scoreboards and the loadout without the map", () => {
    const html = render();

    expect(html).toContain("Blue team");
    expect(html).toContain("Red team");
    expect(html).toContain("Graves");
    expect(html).toContain("Bot Kayle");
    // Classic champions, spells and items resolve through bundled assets.
    expect(html).toContain("Jade_Graves");
    expect(html).toContain("SummonerFlash_Jade");
    expect(html).toContain("771055");
    // Missing facts are stated, never shown as zeros or invented.
    expect(html).toContain("Team objectives not recorded");
    expect(html).toContain("Unknown Riot ID");
  });
});
