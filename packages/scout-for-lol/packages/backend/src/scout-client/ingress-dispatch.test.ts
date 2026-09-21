import { describe, expect, test } from "vitest";
import {
  RawMatchSchema,
  ScoutClientObservationBatchSchema,
} from "@scout-for-lol/data";
import {
  acceptedClientBindingMatchIds,
  acceptedClientMatchDispatches,
} from "./ingress.ts";
import { LOCAL_CANONICAL_DELAY_MS } from "./canonical-match.ts";

const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);
const now = new Date("2026-09-21T12:00:00.000Z");

function observation(args: {
  readonly observationId: string;
  readonly sequence: number;
  readonly resource: string;
  readonly payload?: unknown;
}) {
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    observationId: args.observationId,
    sequence: args.sequence,
    capturedAt: now.toISOString(),
    appVersion: "0.1.0",
    kind: "post_game",
    platformId: fixture.info.platformId,
    localPuuid: fixture.metadata.participants[0],
    gameId: fixture.info.gameId.toString(),
    payload: {
      resource: args.resource,
      data: args.payload ?? fixture,
    },
  } as const;
}

function accepted(observationId: string) {
  return { observationId, outcome: "accepted" } as const;
}

describe("native match dispatch selection", () => {
  test("classifies recent match history as a silent backfill", () => {
    const row = observation({
      observationId: "00000000-0000-4000-8000-000000000001",
      sequence: 1,
      resource: `match_history_game:${fixture.info.gameId.toString()}`,
    });
    const batch = ScoutClientObservationBatchSchema.parse({
      observations: [row],
    });

    expect(
      acceptedClientMatchDispatches(batch, [accepted(row.observationId)], now),
    ).toEqual([
      {
        riotMatchId: fixture.metadata.matchId,
        sourcePuuid: fixture.metadata.participants[0],
        deliveryMode: "silent-backfill",
        gameEndTimestamp: fixture.info.gameEndTimestamp,
        readyAt: new Date(
          now.getTime() + LOCAL_CANONICAL_DELAY_MS,
        ).toISOString(),
        completionTargets: [],
      },
    ]);
  });

  test("lets an observed completion upgrade the same historical match to live", () => {
    const historical = observation({
      observationId: "00000000-0000-4000-8000-000000000002",
      sequence: 2,
      resource: `match_history_game:${fixture.info.gameId.toString()}`,
    });
    const completed = observation({
      observationId: "00000000-0000-4000-8000-000000000003",
      sequence: 3,
      resource: "post_game",
    });
    const batch = ScoutClientObservationBatchSchema.parse({
      observations: [historical, completed],
    });

    expect(
      acceptedClientMatchDispatches(
        batch,
        [accepted(historical.observationId), accepted(completed.observationId)],
        now,
      ),
    ).toMatchObject([{ deliveryMode: "live" }]);
  });

  test("does not dispatch partial or quarantined evidence", () => {
    const partial = observation({
      observationId: "00000000-0000-4000-8000-000000000004",
      sequence: 4,
      resource: `match_history_game:${fixture.info.gameId.toString()}`,
      payload: {
        gameId: fixture.info.gameId,
        platformId: fixture.info.platformId,
        participants: [],
      },
    });
    const quarantined = observation({
      observationId: "00000000-0000-4000-8000-000000000005",
      sequence: 5,
      resource: "post_game",
    });
    const batch = ScoutClientObservationBatchSchema.parse({
      observations: [partial, quarantined],
    });

    expect(
      acceptedClientMatchDispatches(
        batch,
        [
          accepted(partial.observationId),
          { observationId: quarantined.observationId, outcome: "quarantined" },
        ],
        now,
      ),
    ).toEqual([]);
  });

  test("retains a partial live match identity for late-binding reconciliation", () => {
    const partial = observation({
      observationId: "00000000-0000-4000-8000-000000000006",
      sequence: 6,
      resource: "post_game",
      payload: {
        gameId: fixture.info.gameId,
        platformId: fixture.info.platformId,
        participants: fixture.info.participants.map(({ puuid }) => ({ puuid })),
      },
    });
    const batch = ScoutClientObservationBatchSchema.parse({
      observations: [partial],
    });

    expect(
      acceptedClientMatchDispatches(
        batch,
        [accepted(partial.observationId)],
        now,
      ),
    ).toEqual([]);
    expect(
      acceptedClientBindingMatchIds(batch, [accepted(partial.observationId)]),
    ).toEqual([fixture.metadata.matchId]);
  });
});
