import { replayWorkflowFile } from "#activities/media/testing/process.ts";
import path from "node:path";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { assertPrivateHistory } from "#activities/media/testing/history.ts";
import { assertSeriesPackRoleBudgets } from "./history.ts";

export async function replaySeriesPackRoleHistories(input: {
  environment: TestWorkflowEnvironment;
  executions: { workflowId: string; phase: "feed" | "acquire" }[];
  node: string;
  script: string;
  directory: string;
  childEnvironment: { PATH: string };
}) {
  const { environment, node, script, directory, childEnvironment } = input;
  let prepared = false;
  for (const execution of input.executions) {
    const history = await environment.client.workflow
      .getHandle(execution.workflowId)
      .fetchHistory();
    assertSeriesPackRoleBudgets(history, execution.phase === "feed");
    prepared ||=
      history.events?.some((event) =>
        [
          "prepareSeriesPackPublication",
          "prepareSeriesPackMembersPublicationV1",
        ].includes(
          event.activityTaskScheduledEventAttributes?.activityType?.name ?? "",
        ),
      ) ?? false;
    const serialized = historyToJSON(history);
    assertPrivateHistory(serialized, [
      "magnet:",
      "Synthetic.Anime",
      "synthetic-series:",
      "library_series_management",
      "seriesPackSelectionV1",
      "scene-series-pack-v1",
      "encryptedSource",
      "/data/tv",
      "/downloads/media",
    ]);
    const target = path.join(directory, `${execution.workflowId}.json`);
    await Bun.write(target, serialized);
    await replayWorkflowFile({
      node: node,
      script: script,
      filename: target,
      childEnvironment: childEnvironment,
    });
  }
  return prepared;
}
