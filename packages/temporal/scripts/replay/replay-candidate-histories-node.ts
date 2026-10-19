import {
  replayTemporalHistories,
  parseTemporalReplayTargets,
} from "@shepherdjerred/root-scripts/temporal-replay.ts";
import { z } from "zod";

await replayTemporalHistories({
  workflowIds: parseTemporalReplayTargets(process.argv.slice(2), (value) =>
    z.string().min(1).parse(value),
  ),
  emptyMessage: "TEMPORAL_REPLAY_WORKFLOW_IDS must not be empty",
  workflowsPath: new URL("../../src/workflows/index.ts", import.meta.url)
    .pathname,
  environment: globalThis.process.env,
});
