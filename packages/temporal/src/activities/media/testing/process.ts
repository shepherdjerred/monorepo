import assert from "node:assert/strict";

/** Transport only: callers retain their own protocol, privacy and budget checks. */
export async function replayWorkflowFile(input: {
  node: string;
  script: string;
  filename: string;
  childEnvironment: { PATH: string };
}) {
  const replay = Bun.spawn(
    [
      input.node,
      "--experimental-strip-types",
      input.script,
      "replay",
      input.filename,
    ],
    {
      env: input.childEnvironment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, , failure] = await Promise.all([
    replay.exited,
    new Response(replay.stdout).text(),
    new Response(replay.stderr).text(),
  ]);
  assert.equal(exitCode, 0, failure);
}
