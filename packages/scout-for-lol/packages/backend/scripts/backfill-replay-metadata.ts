import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  backfillReplayMetadata,
  parseReplayBackfillArguments,
} from "#src/replays/backfill.ts";

const options = parseReplayBackfillArguments(Bun.argv.slice(2));
const logger = createLogger("replay-metadata-backfill");
try {
  for (const replayId of options.replayIds) {
    logger.info(
      "Replay metadata backfill result",
      await backfillReplayMetadata(replayId, options.apply),
    );
  }
} finally {
  await prisma.$disconnect();
}
