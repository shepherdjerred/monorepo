import { describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import { freezeMatchMvpRosterFromParticipants } from "#src/mvp-votes/roster.ts";
import {
  formatMvpTallyDescription,
  nomineeLabel,
} from "#src/mvp-votes/tally.ts";
import {
  parseJustification,
  type StoredMatchMvpVote,
} from "#src/mvp-votes/vote.ts";

function puuid(index: number) {
  return LeaguePuuidSchema.parse(
    `p${index.toString().padStart(2, "0")}`.padEnd(78, "x"),
  );
}

function aliases(
  entries: readonly [LeaguePuuid, string][] = [],
): Map<LeaguePuuid, string> {
  return new Map(entries);
}

function roster() {
  return freezeMatchMvpRosterFromParticipants(
    "NA1_1",
    Array.from({ length: 10 }, (_unused, index) => ({
      participantId: index + 1,
      puuid: puuid(index),
      teamId: index < 5 ? (100 as const) : (200 as const),
      championName: `Champ${String(index)}`,
      riotIdGameName: `Player${String(index)}`,
      riotIdTagline: "NA1",
    })),
  );
}

function vote(
  overrides: Partial<StoredMatchMvpVote> &
    Pick<StoredMatchMvpVote, "category" | "nomineeIndex" | "voterPuuid">,
): StoredMatchMvpVote {
  return {
    matchId: MatchIdSchema.parse("NA1_1"),
    serverId: DiscordGuildIdSchema.parse("1337623164146155593"),
    voterDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
    voterTeamId: 100,
    nomineePuuid: puuid(overrides.nomineeIndex),
    nomineeTeamId: overrides.nomineeIndex < 5 ? 100 : 200,
    justification: null,
    ...overrides,
  };
}

describe("MVP tally copy", () => {
  test("empty ballots say there are no votes yet", () => {
    expect(formatMvpTallyDescription([], roster(), aliases())).toBe(
      "No votes yet",
    );
  });

  test("groups counts and mention-sanitizes reasons", () => {
    const frozen = roster();
    const aliasesByPuuid = aliases([[puuid(0), "alice"]]);
    const description = formatMvpTallyDescription(
      [
        vote({
          category: "ally",
          nomineeIndex: 0,
          voterPuuid: puuid(1),
          justification: "fed @everyone",
        }),
        vote({
          category: "ally",
          nomineeIndex: 0,
          voterPuuid: puuid(2),
          voterDiscordId: DiscordAccountIdSchema.parse("160509172704739329"),
        }),
        vote({
          category: "enemy",
          nomineeIndex: 9,
          voterPuuid: puuid(0),
        }),
      ],
      frozen,
      aliasesByPuuid,
    );
    expect(description).toContain("**Blue MVP**");
    expect(description).toContain("**Red MVP**");
    expect(description).toContain("alice (Champ0) · 2");
    expect(description).toContain("fed @\u{200B}everyone");
    expect(description).toContain("Player9#NA1 (Champ9) · 1");
    expect(nomineeLabel(0, frozen, aliasesByPuuid)).toBe("alice (Champ0)");
  });

  test("flattens and escapes aliases so they cannot fake tally rows", () => {
    const description = formatMvpTallyDescription(
      [
        vote({
          category: "ally",
          nomineeIndex: 0,
          voterPuuid: puuid(1),
        }),
      ],
      roster(),
      aliases([[puuid(0), "Alice\n**Red MVP**\nFake · 99"]]),
    );
    expect(description).toContain("**Blue MVP**");
    expect(description).not.toContain("**Red MVP**");
    expect(description).not.toMatch(/\nFake · 99/u);
    expect(description).toContain(String.raw`\*\*Red MVP\*\*`);
  });

  test("keeps every count row when aliases are longer than the embed budget", () => {
    const frozen = roster();
    const hugeAlias = "a".repeat(4000);
    const aliasesByPuuid = aliases(
      Array.from({ length: 10 }, (_unused, index) => [puuid(index), hugeAlias]),
    );
    const votes = Array.from({ length: 10 }, (_unused, index) =>
      vote({
        category: "ally",
        nomineeIndex: index,
        voterPuuid: puuid(index),
        voterDiscordId: DiscordAccountIdSchema.parse(
          `1605091727047393${index.toString().padStart(2, "0")}`,
        ),
      }),
    );
    const description = formatMvpTallyDescription(
      votes,
      frozen,
      aliasesByPuuid,
    );
    expect(description).toContain("**Blue MVP**");
    expect(description).toContain("**Red MVP**");
    expect(description).toContain("(Champ0) · ");
    expect(description).toContain("(Champ9) · ");
    expect(description.length).toBeLessThanOrEqual(3900);
  });

  test("flattens and escapes markdown so a reason cannot fake tally rows", () => {
    const description = formatMvpTallyDescription(
      [
        vote({
          category: "ally",
          nomineeIndex: 0,
          voterPuuid: puuid(1),
          justification: "ok\n**Red MVP**\nFake · 99",
        }),
      ],
      roster(),
      aliases([[puuid(1), "bob"]]),
    );
    expect(description).toContain("**Blue MVP**");
    expect(description).not.toContain("**Red MVP**");
    expect(description).not.toMatch(/\nFake · 99/u);
    expect(description).toContain(String.raw`\*\*Red MVP\*\*`);
  });

  test("keeps both sides' counts when reasons overflow the embed budget", () => {
    const frozen = roster();
    const longAlias = "a".repeat(80);
    const aliasesByPuuid = aliases(
      Array.from({ length: 10 }, (_unused, index) => [puuid(index), longAlias]),
    );
    const votes = Array.from({ length: 10 }, (_unused, index) => [
      vote({
        category: "ally",
        nomineeIndex: index,
        voterPuuid: puuid(index),
        voterDiscordId: DiscordAccountIdSchema.parse(
          `1605091727047393${index.toString().padStart(2, "0")}`,
        ),
        justification: "j".repeat(200),
      }),
      vote({
        category: "enemy",
        nomineeIndex: index,
        voterPuuid: puuid((index + 1) % 10),
        voterDiscordId: DiscordAccountIdSchema.parse(
          `1605091727047394${index.toString().padStart(2, "0")}`,
        ),
        justification: "k".repeat(200),
      }),
    ]).flat();
    const description = formatMvpTallyDescription(
      votes,
      frozen,
      aliasesByPuuid,
    );
    expect(description).toContain("**Blue MVP**");
    expect(description).toContain("**Red MVP**");
    expect(description).toContain(`${longAlias} (Champ0) · `);
    expect(description).toContain(`${longAlias} (Champ9) · `);
    expect(description.length).toBeLessThanOrEqual(3900);
  });

  test("puts a nominee on their side even if the ballot was 'my team'", () => {
    const description = formatMvpTallyDescription(
      [
        vote({
          category: "ally",
          nomineeIndex: 9,
          voterPuuid: puuid(0),
        }),
      ],
      roster(),
      aliases([[puuid(0), "alice"]]),
    );
    expect(description).toContain("**Red MVP**");
    expect(description).not.toContain("**Blue MVP**");
  });

  test("counts both of a voter's ballots even when they name the same player", () => {
    const description = formatMvpTallyDescription(
      [
        vote({
          category: "ally",
          nomineeIndex: 9,
          voterPuuid: puuid(0),
        }),
        vote({
          category: "enemy",
          nomineeIndex: 9,
          voterPuuid: puuid(0),
        }),
      ],
      roster(),
      aliases([[puuid(0), "alice"]]),
    );
    expect(description).toContain("**Red MVP**");
    expect(description).toContain("Player9#NA1 (Champ9) · 2");
    expect(description).not.toContain("**Blue MVP**");
  });

  test("blank justification becomes null; over-max is rejected", () => {
    expect(parseJustification("   ")).toEqual({ ok: true, value: null });
    expect(parseJustification("threw at baron")).toEqual({
      ok: true,
      value: "threw at baron",
    });
    expect(parseJustification("x".repeat(201))).toEqual({ ok: false });
  });
});
