import { NativeConnection, Worker } from "@temporalio/worker";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { z } from "zod";
import { forumManifest, StageSchema } from "./config.ts";
import { assembleBundle, releaseForum } from "./release.ts";
import { createMaintainStormForum } from "./activities.ts";
import {
  beginStormForumBackup,
  snapshotStormForum,
  endStormForumBackup,
} from "./backup.ts";
import { restoreForum } from "./restore.ts";
const command = z
  .enum(["assemble", "release", "restore", "worker"])
  .parse(Bun.argv[2]);
switch (command) {
  case "restore": {
    await restoreForum();
    break;
  }
  case "assemble": {
    await assembleBundle();

    break;
  }
  case "release": {
    await releaseForum(StageSchema.parse(Bun.env["STORM_FORUM_STAGE"]));

    break;
  }
  case "worker": {
    const env = z
      .object({
        STORM_FORUM_STAGE: StageSchema,
        TEMPORAL_ADDRESS: z.string().min(1),
        TEMPORAL_NAMESPACE: z.literal("prod"),
      })
      .parse(Bun.env);
    await initFeatureFlags();
    const connection = await NativeConnection.connect({
      address: env.TEMPORAL_ADDRESS,
    });
    try {
      const worker = await Worker.create({
        connection,
        namespace: env.TEMPORAL_NAMESPACE,
        taskQueue: forumManifest.stages[env.STORM_FORUM_STAGE].taskQueue,
        activities: {
          maintainStormForum: createMaintainStormForum(env.STORM_FORUM_STAGE),
          beginStormForumBackup,
          snapshotStormForum,
          endStormForumBackup,
        },
        maxConcurrentActivityTaskExecutions: 1,
      });
      await worker.run();
    } finally {
      await connection.close();
      await shutdownFeatureFlags();
    }

    break;
  }
  default: {
    throw new Error("Usage: cli.ts assemble | release | restore | worker");
  }
}
