import { ApplicationFailure } from "@temporalio/common";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type NotificationIntentKey,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ReceiptKindSchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type {
  ScoutFanOutV2Result,
  ScoutGuardedEffectV2Result,
  ScoutNotificationIntentV2Result,
  ScoutPrematchArchiveV2Result,
  ScoutPrematchScanV2Result,
} from "#src/activity-contracts-v2.ts";
import {
  ScoutNotificationIntentKeySchema,
  ScoutPrematchGameRefSchema,
  type ScoutGameRefV2,
  type ScoutPrematchGameRef,
} from "#src/contracts-v2.ts";

/**
 * A durable store the V2 prematch Activities can be replayed against.
 *
 * It keeps the two things the real prematch path keeps and nothing else: the
 * evidence-bearing receipts that tell a retried capture the snapshot is
 * already archived and staged, and the notification intent rows that tell the
 * fan-out who is owed an announcement. Riot, S3 and the report lake are
 * irrelevant to what survives a crash and are not modelled.
 *
 * {@link ScoutV2PrematchStore.applied} is the assertion surface — one entry
 * per effect the store actually APPLIED. Comparing it across a crashed run and
 * its replacement is what tells "the Activity ran again and found its own work"
 * apart from "the snapshot was archived twice and the channel told twice".
 */

export const GAME_REF: ScoutPrematchGameRef = ScoutPrematchGameRefSchema.parse({
  puuid: "a".repeat(78),
  platform: "NA1",
  gameId: "9101",
});

/** The same live game, surfaced through a second tracked account in it. */
export const SAME_GAME_OTHER_ACCOUNT: ScoutPrematchGameRef =
  ScoutPrematchGameRefSchema.parse({
    puuid: "b".repeat(78),
    platform: "NA1",
    gameId: "9101",
  });

export const OTHER_GAME_REF: ScoutPrematchGameRef =
  ScoutPrematchGameRefSchema.parse({
    puuid: "c".repeat(78),
    platform: "NA1",
    gameId: "9102",
  });

export const PREMATCH_RECEIPT_KINDS = {
  archive: ReceiptKindSchema.parse("raw-archive-prematch"),
  staging: ReceiptKindSchema.parse("lake-staging-prematch"),
} as const;

export const CHANNEL_IDS = ["100000000000000001", "100000000000000002"];

const DESCRIPTOR: ArtifactDescriptor = ArtifactDescriptorSchema.parse({
  kind: "prematch",
  key: "prematch/2026/09/13/9101/spectator-data.json",
  digest: "f".repeat(64),
  bytes: 4096,
  contentType: "application/json",
  capturedAt: "2026-09-13T00:00:00.000Z",
});

export function prematchMatchIdOf(gameRef: ScoutPrematchGameRef): RiotMatchId {
  return RiotMatchIdSchema.parse(`${gameRef.platform}_${gameRef.gameId}`);
}

export function prematchIntentKeyOf(
  gameRef: ScoutPrematchGameRef,
  channelId: string,
): NotificationIntentKey {
  return ScoutNotificationIntentKeySchema.parse(
    `prematch-discord:${prematchMatchIdOf(gameRef)}:${channelId}`,
  );
}

export type ScoutV2PrematchStore = {
  /** False once the game has ended: there is nothing left to capture. */
  live: boolean;
  receiptKinds: ReceiptKind[];
  /** Channels owed an announcement, in the order the capture minted them. */
  intentKeys: NotificationIntentKey[];
  channels: string[];
  lakeProjection: boolean;
  applied: string[];
  calls: string[];
  /**
   * The call the worker dies ON, which models a crash right AFTER the
   * preceding phase committed. Mutable so one worker serves both the run that
   * dies and the run that replaces it: the SDK refuses two workers on one task
   * queue in a process, and a replay is about the durable state the dead run
   * left, not about which process reads it.
   */
  failAt: string | null;
  /**
   * Die INSIDE the capture, after its receipts and intents landed. The other
   * half of the crash contract: the durable work is done but the Workflow
   * never learned it, so the replacement run re-enters the same Activity and
   * has to find its own writes rather than repeat them.
   */
  crashAfterCapture: boolean;
  /**
   * Intents already driven to delivery, under the shared intent key — by a
   * notification child this store served, or by v1 on the far side of an
   * ownership flip. The plan reads them as the real one does: a delivered
   * intent is not drivable.
   */
  delivered: NotificationIntentKey[];
  /**
   * Guilds holding a Bryan Bucks pool for the game, one entry per pool. The
   * markets stub opens one pool per announced channel's guild only where
   * none stands, as `BucksMatchPool`'s unique (match, guild) makes the real
   * open do, so a pool opened twice shows up as a duplicate entry.
   */
  pools: string[];
  /** Fail the markets Activity, to prove the announcement goes out anyway. */
  marketsFail: boolean;
  /** Intent keys a started notification child read, in arrival order. */
  childReads: NotificationIntentKey[];
};

/** Every test channel sits in one guild, which is the case pools dedupe on. */
export const GUILD_ID = "300000000000000001";

export function createScoutV2PrematchStore(
  overrides: Partial<ScoutV2PrematchStore> = {},
): ScoutV2PrematchStore {
  return {
    live: true,
    receiptKinds: [],
    intentKeys: [],
    channels: [...CHANNEL_IDS],
    lakeProjection: false,
    applied: [],
    calls: [],
    failAt: null,
    crashAfterCapture: false,
    delivered: [],
    pools: [],
    marketsFail: false,
    childReads: [],
    ...overrides,
  };
}

/** Leave the store as a prior capture of this game would have. */
export function captured(
  gameRef: ScoutPrematchGameRef = GAME_REF,
): ScoutV2PrematchStore {
  return createScoutV2PrematchStore({
    receiptKinds: [
      PREMATCH_RECEIPT_KINDS.archive,
      PREMATCH_RECEIPT_KINDS.staging,
    ],
    intentKeys: CHANNEL_IDS.map((channelId) =>
      prematchIntentKeyOf(gameRef, channelId),
    ),
    pools: [GUILD_ID],
  });
}

/**
 * The three prematch Activities, backed by {@link ScoutV2PrematchStore}.
 *
 * The capture is written as the real one is: it reads the receipts it already
 * stands behind before writing either, and mints an intent only for a channel
 * that has none. That read-first shape is the whole replay gate, so a fake
 * that skipped it would make the crash tests pass for the wrong reason.
 *
 * Injected failures are non-retryable so an Activity does not quietly re-enter
 * the stub four more times on its way to failing the Workflow.
 */
export function scoutV2PrematchActivityStubs(
  store: ScoutV2PrematchStore,
  games: readonly ScoutPrematchGameRef[] = [GAME_REF],
) {
  const record = (call: string): void => {
    store.calls.push(call);
    if (call === store.failAt) {
      throw ApplicationFailure.nonRetryable(
        `injected crash at ${call}`,
        "InjectedCrash",
      );
    }
  };
  return {
    discoverPrematchGamesV2: (): ScoutPrematchScanV2Result => {
      record("discoverPrematchGamesV2");
      return { games: [...games], complete: true };
    },
    archivePrematchSnapshotV2: (
      input: ScoutGameRefV2,
    ): ScoutPrematchArchiveV2Result => {
      record("archivePrematchSnapshotV2");
      const riotMatchId = prematchMatchIdOf(input.gameRef);
      if (!store.live) {
        // The game ended between the poll that discovered it and this run.
        // There is no snapshot to take and no retry that could find one.
        return { artifacts: [], riotMatchId };
      }
      const artifacts = [
        PREMATCH_RECEIPT_KINDS.archive,
        PREMATCH_RECEIPT_KINDS.staging,
      ].map((kind) => {
        const stored = store.receiptKinds.includes(kind);
        if (!stored) {
          store.receiptKinds.push(kind);
          store.applied.push(kind);
        }
        return {
          descriptor: DESCRIPTOR,
          outcome: stored ? ("already-stored" as const) : ("stored" as const),
          commit: stored ? ("already-applied" as const) : ("applied" as const),
          kind,
        };
      });
      for (const channelId of store.channels) {
        const key = prematchIntentKeyOf(input.gameRef, channelId);
        if (store.intentKeys.includes(key)) continue;
        store.intentKeys.push(key);
        store.applied.push(`intent:${channelId}`);
      }
      if (store.crashAfterCapture) {
        throw ApplicationFailure.nonRetryable(
          "injected crash after the capture committed",
          "InjectedCrash",
        );
      }
      return {
        riotMatchId,
        artifacts: artifacts.map((artifact) => ({
          descriptor: artifact.descriptor,
          outcome: artifact.outcome,
          receipt: {
            kind: artifact.kind,
            commit: { outcome: artifact.commit },
          },
        })),
      };
    },
    planPrematchFanOutV2: (input: {
      riotMatchId: string;
    }): ScoutFanOutV2Result => {
      record("planPrematchFanOutV2");
      const prefix = `prematch-discord:${input.riotMatchId}:`;
      return {
        notificationIntentKeys: store.intentKeys.filter(
          (key) => key.startsWith(prefix) && !store.delivered.includes(key),
        ),
        lakeProjection: store.lakeProjection,
      };
    },
    openPrematchMarketsV2: (): ScoutGuardedEffectV2Result => {
      record("openPrematchMarketsV2");
      if (store.marketsFail) {
        throw ApplicationFailure.nonRetryable(
          "injected markets failure",
          "InjectedCrash",
        );
      }
      if (store.intentKeys.length === 0 || store.pools.includes(GUILD_ID)) {
        return {
          guard: { outcome: "already-applied" },
          fact: { outcome: "already-applied" },
          effects: 0,
        };
      }
      store.pools.push(GUILD_ID);
      store.applied.push(`pool:${GUILD_ID}`);
      return {
        guard: { outcome: "applied" },
        fact: { outcome: "applied" },
        effects: 1,
      };
    },
    /**
     * Just enough of the notification child for it to finish: the child's
     * first read counts as its delivery and it then sees a terminal intent,
     * so it records nothing further and completes. The prematch tests assert
     * WHICH children started and that each intent is delivered once, not how
     * the notification machine drives one — `durable-v2.test.ts` owns that.
     */
    readNotificationIntentV2: (input: {
      intentKey: NotificationIntentKey;
    }): ScoutNotificationIntentV2Result => {
      // Kept out of `calls`: the children run after their parent returns, so
      // an ordered record of the parent's Activities must not interleave them.
      store.childReads.push(input.intentKey);
      if (!store.delivered.includes(input.intentKey)) {
        store.delivered.push(input.intentKey);
      }
      return {
        kind: "present",
        intent: {
          intentKey: input.intentKey,
          state: {
            kind: "delivered",
            deliveredAt: IsoInstantSchema.parse("2026-09-13T00:00:01.000Z"),
          },
          attemptCount: 1,
        },
        gate: {
          kind: "prematch",
          target: "channel",
          policy: "normal",
          decision: "permitted",
        },
      };
    },
  };
}
