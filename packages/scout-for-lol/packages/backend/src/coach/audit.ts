import type { DiscordAccountId, ExploreActiveRun } from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import type {
  CoachContextProjection,
  CoachPolicyFlags,
  CoachTurnInitiation,
} from "./context-policy.ts";

/**
 * What a coach turn's audit row says beyond its run: which device sent the
 * context, how the turn began, what the coach policy made of it, and the
 * flags it was judged under. The run manager writes it with the run.
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
};

/**
 * Record one turn that carried a game context: who sent it from which device,
 * how the turn began, what it carried, what the coach policy let through, and
 * both flags as evaluated. Identifiers and section names only; the context
 * itself never reaches this table.
 *
 * Pass the transaction that reserves the run, so a turn is never started
 * without its row.
 */
export async function recordCoachTurn(
  client: Pick<Db, "scoutCoachTurn">,
  input: {
    readonly ownerId: DiscordAccountId;
    readonly run: ExploreActiveRun;
    readonly record: CoachTurnRecord;
  },
): Promise<void> {
  const { record } = input;
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
    },
  });
}
