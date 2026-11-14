import {
  projectPostGameOutcome,
  type CanonicalMatch,
  type QueueType,
  type ScoutClientObservationBatch,
  type ScoutClientPostGameOutcome,
} from "@scout-for-lol/data";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ScoutClientMatchDispatchItem } from "@scout-for-lol/temporal/workflow-contracts";
import { scoutClientEndOfGameDeadlineSeconds } from "#src/config/dynamic.ts";
import { prisma } from "#src/database/index.ts";
import { endOfGameEvidenceReadyAt } from "#src/evidence/source-grace.ts";
import { unconvertedConversion } from "#src/scout-client/canonical/end-of-game-result.ts";
import { postGameDeliveryMode } from "#src/scout-client/dispatch-policy.ts";
import type { IdentityMap } from "#src/scout-client/identity-alias.ts";
import { translateObservation } from "#src/scout-client/observation-identity.ts";
import { gameKindOf } from "#src/scout-client/telemetry/capture-metrics.ts";
import { gameflowsBefore, parseLocalEndOfGameMatch } from "./observation.ts";

/**
 * Dispatching an end-of-game-only game: an accepted `post_game` upload that
 * carries the end-of-game block alone and converts, with its device's earlier
 * gameflow session, to an end-of-game record. Its item is ready at the
 * record's deadline, when `resolveCanonicalMatch` may freeze it. Complete
 * bundles are selected beside this, by the ordinary client dispatch; the two
 * merge here, so a game is dispatched once.
 */

/** A receipt as dispatch reads it: which observation, and whether it stands. */
type DispatchReceipt = {
  readonly observationId: string;
  readonly outcome: "accepted" | "already_accepted" | "quarantined";
};

/** One post-game upload's telemetry outcome, as the ordinary dispatch counts it. */
type PostGameEvaluation = {
  readonly observationId: string;
  readonly outcome: ScoutClientPostGameOutcome;
  readonly gameKind: QueueType | "unknown";
};

/**
 * A post-game selection: its dispatch items, its telemetry outcomes, and the
 * game each item converted to, by match ID (Clash shadowing reads it).
 */
type PostGameSelection = {
  readonly dispatches: readonly ScoutClientMatchDispatchItem[];
  readonly evaluations: readonly PostGameEvaluation[];
  readonly games: ReadonlyMap<string, CanonicalMatch["info"]>;
};

/**
 * What an end-of-game-only upload needs to become a dispatch: the gameflow
 * sessions its device reported before it (by observation ID, latest first),
 * and how long the record waits for the game's history bundle.
 */
export type EndOfGameDispatchContext = {
  readonly gameflows: ReadonlyMap<string, readonly unknown[]>;
  readonly deadlineMs: number;
};

function acceptedEndOfGameUploads(
  batch: ScoutClientObservationBatch,
  receipts: readonly DispatchReceipt[],
) {
  const accepted = new Set(
    receipts
      .filter((receipt) => receipt.outcome !== "quarantined")
      .map((receipt) => receipt.observationId),
  );
  return batch.observations.filter(
    (observation) =>
      observation.kind === "post_game" &&
      accepted.has(observation.observationId) &&
      unconvertedConversion(observation.payload) === "end_of_game_only",
  );
}

/**
 * The end-of-game-only uploads in a batch, as dispatch items and telemetry
 * outcomes. Pure: the gameflow sessions and the deadline come in `endOfGame`.
 * An upload that does not convert is left to the ordinary dispatch, which
 * counts it as before.
 */
export function selectEndOfGameDispatches(
  batch: ScoutClientObservationBatch,
  receipts: readonly DispatchReceipt[],
  context: {
    readonly now: Date;
    readonly identities: IdentityMap;
    readonly endOfGame: EndOfGameDispatchContext;
  },
): PostGameSelection {
  const dispatches: ScoutClientMatchDispatchItem[] = [];
  const evaluations: PostGameEvaluation[] = [];
  const games = new Map<string, CanonicalMatch["info"]>();
  for (const raw of acceptedEndOfGameUploads(batch, receipts)) {
    const observation = translateObservation(raw, context.identities);
    const gameflows = context.endOfGame.gameflows.get(
      observation.observationId,
    );
    if (
      gameflows === undefined ||
      observation.platformId === undefined ||
      observation.gameId === undefined ||
      observation.localPuuid === undefined
    )
      continue;
    const riotMatchId = RiotMatchIdSchema.safeParse(
      `${observation.platformId.toUpperCase()}_${observation.gameId}`,
    );
    if (!riotMatchId.success) continue;
    const record = parseLocalEndOfGameMatch(
      riotMatchId.data,
      {
        platformId: observation.platformId,
        localPuuid: observation.localPuuid,
        payload: raw.payload,
      },
      gameflows,
      context.identities,
    );
    if (record === null) continue;
    const deliveryMode = postGameDeliveryMode(
      observation,
      record.info.gameEndTimestamp,
      context.now,
    );
    evaluations.push({
      observationId: observation.observationId,
      outcome: projectPostGameOutcome({
        identityResolved: true,
        conversion: "end_of_game_only",
        deliveryMode,
      }),
      gameKind: gameKindOf(record.info),
    });
    if (deliveryMode === null) continue;
    games.set(riotMatchId.data, record.info);
    dispatches.push({
      riotMatchId: riotMatchId.data,
      sourcePuuid: LeaguePuuidSchema.parse(observation.localPuuid),
      deliveryMode,
      gameEndTimestamp: record.info.gameEndTimestamp,
      readyAt: IsoInstantSchema.parse(
        endOfGameEvidenceReadyAt(
          record.info,
          context.now,
          context.endOfGame.deadlineMs,
        ).toISOString(),
      ),
      completionTargets: [],
      orderingAssured: false,
    });
  }
  return { dispatches, evaluations, games };
}

/**
 * Read the gameflow sessions each accepted end-of-game-only upload in the
 * batch converts with (the same device's sessions before it, as the resolver
 * reads them at selection) and select its dispatches.
 */
export async function endOfGameDispatches(
  batch: ScoutClientObservationBatch,
  receipts: readonly DispatchReceipt[],
  context: { readonly now: Date; readonly identities: IdentityMap },
): Promise<PostGameSelection> {
  const uploads = acceptedEndOfGameUploads(batch, receipts);
  const stored =
    uploads.length === 0
      ? []
      : await prisma.scoutClientObservation.findMany({
          where: {
            observationId: {
              in: uploads.map((observation) => observation.observationId),
            },
          },
          select: {
            observationId: true,
            deviceId: true,
            sequence: true,
            gameId: true,
            platformId: true,
            localPuuid: true,
            payload: true,
          },
        });
  const gameflows = new Map<string, readonly unknown[]>();
  for (const observation of stored)
    gameflows.set(
      observation.observationId,
      await gameflowsBefore(observation),
    );
  return selectEndOfGameDispatches(batch, receipts, {
    ...context,
    endOfGame: {
      gameflows,
      deadlineMs: scoutClientEndOfGameDeadlineSeconds() * 1000,
    },
  });
}

function preferredDispatch(
  existing: ScoutClientMatchDispatchItem,
  incoming: ScoutClientMatchDispatchItem,
): ScoutClientMatchDispatchItem {
  if (existing.deliveryMode !== incoming.deliveryMode)
    return incoming.deliveryMode === "live" ? incoming : existing;
  return Date.parse(incoming.readyAt) < Date.parse(existing.readyAt)
    ? incoming
    : existing;
}

/**
 * Merge the end-of-game selection into the ordinary one. A game is dispatched
 * once: a live item over a backfill, then the earlier `readyAt`, as the
 * dispatcher's own merge decides, so a bundle for the same game wins over its
 * block's deadline. An upload's end-of-game outcome replaces the "did not
 * convert" outcome the ordinary selection counted for it, and its game joins
 * the ordinary selection's games.
 */
export function withEndOfGameDispatches(
  selection: PostGameSelection,
  endOfGame: PostGameSelection,
): PostGameSelection {
  const items = new Map<string, ScoutClientMatchDispatchItem>();
  for (const item of [...selection.dispatches, ...endOfGame.dispatches]) {
    const existing = items.get(item.riotMatchId);
    items.set(
      item.riotMatchId,
      existing === undefined ? item : preferredDispatch(existing, item),
    );
  }
  const counted = new Set(
    endOfGame.evaluations.map((evaluation) => evaluation.observationId),
  );
  return {
    games: new Map([...endOfGame.games, ...selection.games]),
    dispatches: [...items.values()].sort(
      (left, right) =>
        left.gameEndTimestamp - right.gameEndTimestamp ||
        left.riotMatchId.localeCompare(right.riotMatchId),
    ),
    evaluations: [
      ...selection.evaluations.filter(
        (evaluation) => !counted.has(evaluation.observationId),
      ),
      ...endOfGame.evaluations,
    ],
  };
}

/**
 * Ingress's whole post-game selection at one instant: the ordinary `evaluate`
 * (complete bundles) with the end-of-game-only uploads merged in.
 */
export async function selectPostGameDispatches<R extends DispatchReceipt>(
  selection: {
    readonly batch: ScoutClientObservationBatch;
    readonly receipts: readonly R[];
    readonly evaluate: (
      batch: ScoutClientObservationBatch,
      receipts: readonly R[],
      now: Date,
      identities: IdentityMap,
    ) => PostGameSelection;
  },
  identities: IdentityMap,
): Promise<PostGameSelection> {
  const { batch, receipts, evaluate } = selection;
  const now = new Date();
  return withEndOfGameDispatches(
    evaluate(batch, receipts, now, identities),
    await endOfGameDispatches(batch, receipts, { now, identities }),
  );
}
