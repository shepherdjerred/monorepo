import type { DiscordAccountId, ExploreActiveRun } from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import type {
  CoachContextProjection,
  CoachPolicyFlags,
  CoachTurnInitiation,
} from "./context-policy.ts";

/**
 * Record one turn that carried a game context: who sent it from which device,
 * how the turn began, what it carried, what the coach policy let through, and
 * both flags as evaluated. Identifiers and section names only; the context
 * itself never reaches this table.
 */
export async function recordCoachTurn(
  client: Pick<Db, "scoutCoachTurn">,
  input: {
    readonly ownerId: DiscordAccountId;
    readonly deviceId: string;
    readonly run: ExploreActiveRun;
    readonly initiation: CoachTurnInitiation;
    readonly projection: CoachContextProjection;
    readonly flags: CoachPolicyFlags;
  },
): Promise<void> {
  await client.scoutCoachTurn.create({
    data: {
      ownerId: input.ownerId,
      deviceId: input.deviceId,
      conversationId: input.run.conversationId,
      runId: input.run.runId,
      questionMessageId: input.run.questionMessageId,
      initiation: input.initiation,
      sectionsPresent: [...input.projection.present],
      sectionsAccepted: [...input.projection.accepted],
      coachEnabled: input.flags.coachEnabled,
      liveAnswersEnabled: input.flags.liveAnswersEnabled,
    },
  });
}
