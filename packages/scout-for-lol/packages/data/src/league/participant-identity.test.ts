import { describe, expect, test } from "vitest";
import { SCOUT_CLIENT_DATA_VERSION } from "#src/league/data-source.ts";
import {
  participantIdentityOf,
  participantKindOf,
  sameStoredIdentity,
  storedParticipantIdentity,
} from "#src/league/participant-identity.ts";
import { RawMatchSchema, type RawMatch } from "#src/league/raw-match.schema.ts";

const RIOT_MATCH = `${import.meta.dir}/../../../backend/src/league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
const LCU_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

async function riotMatch(): Promise<RawMatch> {
  return RawMatchSchema.parse(await Bun.file(RIOT_MATCH).json());
}

/** The Riot fixture rebuilt as a Scout document naming a bot and an unresolved player. */
function scoutBuilt(match: RawMatch) {
  const participants = match.info.participants.map((participant, index) => {
    if (index === 0)
      return { ...participant, puuid: null, participantKind: "bot" };
    if (index === 1) {
      return {
        ...participant,
        puuid: null,
        participantKind: "unresolved",
        leagueClientUuid: LCU_UUID,
      };
    }
    return { ...participant, participantKind: "player" };
  });
  return {
    metadata: {
      ...match.metadata,
      dataVersion: SCOUT_CLIENT_DATA_VERSION,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: { ...match.info, participants },
  };
}

describe("stored participant identity", () => {
  test("a Riot document with a malformed PUUID fails loudly", async () => {
    const match = await riotMatch();
    const [first, ...rest] = match.info.participants;
    if (first === undefined) throw new Error("Fixture has no participants");

    for (const puuid of ["BOT", "00000000-0000-0000-0000-000000000000", null]) {
      const result = RawMatchSchema.safeParse({
        ...match,
        info: { ...match.info, participants: [{ ...first, puuid }, ...rest] },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/78-character/u);
    }
  });

  test("a Riot document never states a participant kind", async () => {
    const match = await riotMatch();
    const result = RawMatchSchema.safeParse({
      ...match,
      info: {
        ...match.info,
        participants: match.info.participants.map((participant) => ({
          ...participant,
          participantKind: "player",
        })),
      },
    });
    expect(result.success).toBe(false);
  });

  test("a Scout document names bots and unresolved players without a PUUID", async () => {
    const parsed = RawMatchSchema.parse(scoutBuilt(await riotMatch()));
    const [bot, unresolved, player] = parsed.info.participants;
    if (bot === undefined || unresolved === undefined || player === undefined)
      throw new Error("Fixture needs three participants");

    expect(participantIdentityOf(bot)).toEqual({ kind: "bot" });
    expect(participantIdentityOf(unresolved)).toEqual({
      kind: "local",
      uuid: LCU_UUID,
    });
    expect(participantKindOf(player)).toBe("player");
    expect(parsed.metadata.participants).toHaveLength(
      parsed.info.participants.length - 2,
    );
    expect(parsed.metadata.participants).not.toContain(LCU_UUID);
  });

  test("a Scout document's metadata lists exactly its players", async () => {
    const document = scoutBuilt(await riotMatch());
    expect(
      RawMatchSchema.safeParse({
        ...document,
        metadata: {
          ...document.metadata,
          participants: [LCU_UUID, ...document.metadata.participants],
        },
      }).success,
    ).toBe(false);
  });

  test("an unresolved UUID can never sit in puuid", async () => {
    const document = scoutBuilt(await riotMatch());
    const [, unresolved, ...rest] = document.info.participants;
    if (unresolved === undefined) throw new Error("Fixture needs participants");
    const [bot] = document.info.participants;
    if (bot === undefined) throw new Error("Fixture needs participants");
    expect(
      RawMatchSchema.safeParse({
        ...document,
        info: {
          ...document.info,
          participants: [bot, { ...unresolved, puuid: LCU_UUID }, ...rest],
        },
      }).success,
    ).toBe(false);
  });

  test("a kindless Scout document from before kinds existed reads as players", async () => {
    const match = await riotMatch();
    const legacy = RawMatchSchema.parse({
      ...match,
      metadata: { ...match.metadata, dataVersion: SCOUT_CLIENT_DATA_VERSION },
    });
    expect(
      legacy.info.participants.every(
        (participant) => participantKindOf(participant) === "player",
      ),
    ).toBe(true);
  });

  test("stored fields round-trip the shared identity vocabulary", () => {
    for (const identity of [
      { kind: "riot", puuid: "p".repeat(78) },
      { kind: "bot" },
      { kind: "local", uuid: LCU_UUID },
      { kind: "unresolved" },
    ] as const) {
      expect(
        participantIdentityOf(storedParticipantIdentity(identity)),
      ).toEqual(identity);
    }
    expect(
      sameStoredIdentity(
        storedParticipantIdentity({ kind: "bot" }),
        storedParticipantIdentity({ kind: "local", uuid: LCU_UUID }),
      ),
    ).toBe(false);
  });
});
