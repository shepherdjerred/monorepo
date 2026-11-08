import { expect } from "vitest";
import { createMovieRetentionFixture } from "./retention-fixture.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { MovieRemovalCompletionV4Schema } from "#shared/movie-editions/removal-v4.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { purgeMovieFilesV4 } from "#automation/movie-editions/retention/purge.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { NotificationContext } from "#automation/notifications/types.ts";
import { createNotificationActivities } from "#automation/notifications.ts";

/** Real acquisition, accepted warning and physical removal; only remote transports and policy time are synthetic. */
export async function createMovieRemovalNoticeFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
) {
  const f = await createMovieRetentionFixture(edition, bytes);
  try {
    await f.db.notificationPreference.update({
      where: { userId: f.source.user.id },
      data: { removalCompleted: true },
    });
    expect(await f.warning()).toMatchObject({ status: "warning" });
    await f.deliverWarning();
    const evaluated = await f.evaluate();
    if (evaluated.status !== "quarantine" || evaluated.decisionId === null)
      throw new Error("Actual warning did not authorize quarantine");
    const completion = MovieRemovalCompletionV4Schema.parse({
      schemaVersion: 4,
      operationId: f.input.operationId,
      decisionId: evaluated.decisionId,
      scope: f.scope,
      stage: "quarantined",
    });
    const files = () => {
      const execution = testPublicationExecution();
      return {
        ...f.source.files.context,
        now: () => new Date(Date.now() + 8 * 86_400_000),
        publicationExecution: () => execution,
        movieManagement: {
          execution,
          budget: new PublicationAuthorityReadBudget(),
        },
      };
    };
    await quarantineMovieFilesV4(files(), {
      schemaVersion: 4,
      operationId: completion.operationId,
      decisionId: completion.decisionId,
      scope: completion.scope,
    });
    return {
      ...f,
      completion,
      async purge() {
        expect(await f.evaluate()).toMatchObject({ status: "purge" });
        await purgeMovieFilesV4(files(), {
          schemaVersion: 4,
          operationId: completion.operationId,
          decisionId: completion.decisionId,
          scope: completion.scope,
        });
        return MovieRemovalCompletionV4Schema.parse({
          ...completion,
          stage: "purged",
        });
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

export type MovieRemovalNoticeFixture = Awaited<
  ReturnType<typeof createMovieRemovalNoticeFixture>
>;

export function removalDeliveryInvocation(
  f: Pick<MovieRemovalNoticeFixture, "context">,
) {
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  const context: NotificationContext = {
    ...f.context,
    plexBindingExecution: () => execution,
    movieManagement: { execution, budget },
  };
  return { context, execution, budget };
}

export async function deliverRemovalNotice(
  f: Pick<MovieRemovalNoticeFixture, "db">,
  context: NotificationContext,
  notificationId: string,
) {
  const operation = await f.db.operation.findFirstOrThrow({
    where: { kind: "deliver_notification", targetId: notificationId },
  });
  return createNotificationActivities(context).deliverMediaNotification({
    operationId: operation.id,
    notificationId,
  });
}
