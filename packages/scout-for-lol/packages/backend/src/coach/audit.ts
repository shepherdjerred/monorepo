import type {
  DiscordAccountId,
  ExploreActiveRun,
  ScoutDesktopVoiceTrigger,
  ScoutDesktopVoiceWakeVerification,
} from "@scout-for-lol/data";
import { resolveEnvironment, type Environment } from "#src/configuration.ts";
import type { Db } from "#src/database/index.ts";
import {
  COACH_PROACTIVE_INITIATION,
  type CoachContextProjection,
  type CoachPolicyFlags,
  type CoachTurnInitiation,
} from "./context-policy.ts";
import { proactiveRefusedIn } from "./proactive-policy.ts";
import {
  admitProactiveTrigger,
  prismaReceiptStore,
  type ProactiveTriggerRecord,
} from "./proactive-triggers.ts";

/**
 * How a spoken turn proved the player asked: what started the recording, and
 * how the server judged the wake phrase in its own transcript.
 */
export type CoachVoiceProof = {
  readonly trigger: ScoutDesktopVoiceTrigger;
  readonly wake: ScoutDesktopVoiceWakeVerification;
};

/**
 * What a coach turn's audit row says beyond its run: which device sent the
 * context, how the turn began, what the coach policy made of it, and the
 * flags it was judged under. The run manager writes it with the run.
 *
 * `voice` is present exactly on a `player_voice` turn; the table refuses
 * either without the other.
 */
export type CoachTurnRecord = {
  readonly deviceId: string;
  readonly initiation: CoachTurnInitiation;
  /**
   * The client's id for the champ select or game an app-started turn belongs
   * to, which the per-game limit counts by; null for a player-typed turn.
   */
  readonly gameKey: string | null;
  readonly projection: CoachContextProjection;
  readonly flags: CoachPolicyFlags;
  readonly voice?: CoachVoiceProof | undefined;
  /**
   * The trigger a proactive turn admits; present exactly when the initiation
   * is `app_proactive`.
   */
  readonly trigger?: ProactiveTriggerRecord;
};

/**
 * The trigger and game a proactive turn admits, or null for any other turn.
 * Checked before anything is written. The route refuses production first, so
 * a proactive record reaching here in production is a broken contract: no
 * proactive turn may start there whatever the caller says.
 */
export function proactiveTriggerOf(
  record: CoachTurnRecord,
  environment: Environment,
): {
  readonly gameKey: string;
  readonly trigger: ProactiveTriggerRecord;
} | null {
  const proactive = record.initiation === COACH_PROACTIVE_INITIATION;
  if (proactive !== (record.trigger !== undefined)) {
    throw new Error(
      "A coach turn carries a trigger exactly when it is a proactive turn.",
    );
  }
  if (record.trigger === undefined) return null;
  if (proactiveRefusedIn(environment)) {
    throw new Error("A proactive coach turn never starts in production.");
  }
  if (record.gameKey === null) {
    throw new Error("A proactive coach turn names its game.");
  }
  return { gameKey: record.gameKey, trigger: record.trigger };
}

/**
 * Record one turn that carried a game context or was spoken: who sent it from
 * which device, how the turn began (and, spoken, its trigger and wake
 * verification), what it carried, what the coach policy let through, and both
 * flags as evaluated. Identifiers and section names only; neither the context
 * nor the transcript reaches this table.
 *
 * Pass the transaction that reserves the run, so a turn is never started
 * without its row. A proactive turn first admits its trigger receipt
 * (`coach/proactive-triggers.ts`), which throws `ProactiveTriggerRefusedError`
 * for a duplicate, a full game or a trigger too soon, rolling the run back.
 */
export async function recordCoachTurn(
  client: Pick<
    Db,
    "scoutCoachTurn" | "scoutCoachTriggerReceipt" | "$executeRaw"
  >,
  input: {
    readonly ownerId: DiscordAccountId;
    readonly run: ExploreActiveRun;
    readonly record: CoachTurnRecord;
    readonly now?: Date;
  },
): Promise<void> {
  const { record } = input;
  const trigger = proactiveTriggerOf(record, resolveEnvironment());
  if (trigger !== null) {
    await admitProactiveTrigger(prismaReceiptStore(client), {
      ownerId: input.ownerId,
      deviceId: record.deviceId,
      gameKey: trigger.gameKey,
      trigger: trigger.trigger,
      runId: input.run.runId,
      now: input.now ?? new Date(),
    });
  }
  await client.scoutCoachTurn.create({
    data: {
      ownerId: input.ownerId,
      deviceId: record.deviceId,
      conversationId: input.run.conversationId,
      runId: input.run.runId,
      questionMessageId: input.run.questionMessageId,
      initiation: record.initiation,
      gameKey: record.gameKey,
      sectionsPresent: [...record.projection.present],
      sectionsAccepted: [...record.projection.accepted],
      coachEnabled: record.flags.coachEnabled,
      liveAnswersEnabled: record.flags.liveAnswersEnabled,
      voiceTrigger: record.voice?.trigger ?? null,
      wakeVerification: record.voice?.wake ?? null,
    },
  });
}
