import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { Db } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";

/** One observation a Scout desktop client sent about a game. */
export type MatchObservationSupplier = {
  readonly observationId: string;
  readonly kind: string;
  readonly disposition: string;
  readonly capturedAt: Date;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceState: string;
  readonly ownerId: string;
};

export type MatchContributors = {
  readonly matchId: RiotMatchId;
  /**
   * The device whose upload became the stored match, or `null` when the match
   * was not client-supplied (Riot's own payload, or nothing selected).
   */
  readonly source: {
    readonly observationId: string;
    readonly selectedAt: Date;
    readonly deviceId: string;
    readonly deviceName: string;
    readonly deviceState: string;
    readonly ownerId: string;
  } | null;
  /**
   * Every post-game observation any device sent for this game, selected or
   * not. A client-supplied timeline is drawn from these: the archived
   * timeline does not record which one it used.
   */
  readonly observations: readonly MatchObservationSupplier[];
};

/**
 * Who supplied the data behind a match: the source device and its signed-in
 * owner, and every observation id for the game.
 *
 * The join is `ScoutClientCanonicalMatch.sourceObservationId` →
 * `ScoutClientObservation.deviceId` → `ScoutClientDevice.ownerId`. The owner is
 * the Scout user who approved the pairing, so every device has one.
 */
export async function lookupMatchContributors(
  db: Db,
  matchId: RiotMatchId,
): Promise<MatchContributors> {
  const platform = platformRouteOf(matchId);
  const gameId = matchId.slice(matchId.indexOf("_") + 1);
  const [selected, observations] = await Promise.all([
    db.scoutClientCanonicalMatch.findUnique({
      where: { riotMatchId: matchId },
      include: { sourceObservation: { include: { device: true } } },
    }),
    db.scoutClientObservation.findMany({
      where: {
        kind: "post_game",
        gameId,
        platformId: { equals: platform, mode: "insensitive" },
      },
      include: { device: true },
      orderBy: [{ capturedAt: "asc" }, { observationId: "asc" }],
    }),
  ]);
  return {
    matchId,
    source:
      selected === null
        ? null
        : {
            observationId: selected.sourceObservationId,
            selectedAt: selected.selectedAt,
            deviceId: selected.sourceObservation.deviceId,
            deviceName: selected.sourceObservation.device.deviceName,
            deviceState: selected.sourceObservation.device.deviceState,
            ownerId: selected.sourceObservation.device.ownerId,
          },
    observations: observations.map((row) => ({
      observationId: row.observationId,
      kind: row.kind,
      disposition: row.disposition,
      capturedAt: row.capturedAt,
      deviceId: row.deviceId,
      deviceName: row.device.deviceName,
      deviceState: row.device.deviceState,
      ownerId: row.device.ownerId,
    })),
  };
}
