import assert from "node:assert/strict";
import path from "node:path";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import {
  assertPrivateHistory,
  assertScopedMovieActivityBudgets,
} from "./history.ts";

/** Replay the original history with a credentialless Node process after checking actual payloads. */
export async function verifyMovieHistory(
  history: Parameters<typeof historyToJSON>[0],
  options: {
    node: string;
    script: string;
    directory: string;
    name: string;
    childEnvironment: { PATH: string };
  },
) {
  assert.match(options.name, /^[a-z0-9-]+$/u);
  assertScopedMovieActivityBudgets(history);
  const serialized = historyToJSON(history);
  assertPrivateHistory(serialized, [
    "magnet:",
    "Workflow.Fixture",
    "synthetic-workflow-release",
    "encryptedSource",
    "/data/movies",
    "/downloads/media",
    "Synthetic human caption",
  ]);
  const target = path.join(options.directory, `${options.name}.json`);
  await Bun.write(target, serialized);
  const replay = Bun.spawn(
    [
      options.node,
      "--experimental-strip-types",
      options.script,
      "replay",
      target,
    ],
    {
      env: options.childEnvironment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, , error] = await Promise.all([
    replay.exited,
    new Response(replay.stdout).text(),
    new Response(replay.stderr).text(),
  ]);
  assert.equal(exitCode, 0, error);
}
