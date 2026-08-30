import type { CustomNightSnapshot } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { syncCustomRecruitmentMessage } from "#src/customs/recruitment-message.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-after-mutation");

type CommittedMutationOperations<T> = {
  readonly syncRecruitment: () => Promise<void>;
  readonly publishSnapshot: () => Promise<void>;
  readonly readSnapshot: () => Promise<T>;
  readonly reportRecruitmentFailure: (error: unknown) => void;
};

export async function completeCommittedCustomMutation<T>(
  operations: CommittedMutationOperations<T>,
): Promise<T> {
  try {
    await operations.syncRecruitment();
  } catch (error) {
    operations.reportRecruitmentFailure(error);
  }
  await operations.publishSnapshot();
  return operations.readSnapshot();
}

export async function customSnapshotAfterMutation(
  client: ExtendedPrismaClient,
  nightId: string,
  viewerDiscordId: string,
  viewerAdministrator = false,
): Promise<CustomNightSnapshot> {
  return completeCommittedCustomMutation({
    syncRecruitment: async () => {
      await syncCustomRecruitmentMessage(client, nightId);
    },
    publishSnapshot: async () => {
      await publishCustomNightSnapshot(nightId);
    },
    readSnapshot: async () => {
      const snapshot = await buildCustomNightSnapshot(
        client,
        nightId,
        viewerDiscordId,
        { viewerAdministrator },
      );
      if (snapshot === undefined) {
        throw new Error("Custom night does not exist after its mutation");
      }
      return snapshot;
    },
    reportRecruitmentFailure: (error) => {
      logger.error("Customs recruitment delivery failed after domain commit", {
        error,
        nightId,
      });
    },
  });
}
