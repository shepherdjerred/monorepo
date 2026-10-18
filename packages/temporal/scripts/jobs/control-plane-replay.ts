import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ControlPlaneExecution } from "#lib/delivery/platform/control-plane-history.ts";
import type { ControlPlaneUpgradeSnapshot } from "@shepherdjerred/delivery/contract";
import { ControlPlaneReplayReceiptSchema } from "#lib/delivery/platform/control-plane-history.ts";

/** Same frozen install/build path as the native replay tooling; no provider/vault credentials enter children. */
export async function replayControlPlaneCandidate(
  snapshot: ControlPlaneUpgradeSnapshot,
  execution: ControlPlaneExecution,
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-candidate-replay-"),
  );
  const environment = {
    PATH: Bun.env["PATH"],
    HOME: Bun.env["HOME"],
    TMPDIR: Bun.env["TMPDIR"],
    MISE_DATA_DIR: Bun.env["MISE_DATA_DIR"],
    MISE_LOCKED: "1",
    TEMPORAL_ADDRESS: Bun.env["TEMPORAL_ADDRESS"],
    TEMPORAL_NAMESPACE: "prod",
  };
  const run = async (command: string[], cwd = directory) => {
    const child = Bun.spawn(command, {
      cwd,
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of child.stdout) {
      bytes += chunk.byteLength;
      if (bytes > 4 * 1024 * 1024) {
        child.kill("SIGKILL");
        await child.exited;
        throw new Error("Candidate replay command exceeded bounded output");
      }
      chunks.push(chunk);
    }
    if ((await child.exited) !== 0)
      throw new Error(
        "Exact candidate source build/history replay failed; control-plane source remains unselected",
      );
    return Buffer.concat(chunks).toString("utf8").trim();
  };
  try {
    const source = snapshot.nextArtifact.sourceRevision;
    await run(["git", "init", "--quiet"]);
    await run([
      "git",
      "fetch",
      "--quiet",
      "--depth=1",
      "https://github.com/shepherdjerred/monorepo.git",
      source,
    ]);
    await run(["git", "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    if ((await run(["git", "rev-parse", "HEAD"])) !== source)
      throw new Error(
        "Candidate replay source differs from original image source",
      );
    await run(["mise", "trust", ".mise.toml"]);
    await run(["mise", "install", "--yes", "bun", "node"]);
    await run(["mise", "exec", "--", "bun", "install", "--frozen-lockfile"]);
    for (const packageName of [
      "home-assistant",
      "llm-models",
      "glitter-context",
    ])
      await run(
        ["mise", "exec", "--", "bun", "run", "build"],
        path.join(directory, "packages", packageName),
      );
    const status = await run([
      "git",
      "status",
      "--porcelain=v1",
      "--untracked-files=no",
    ]);
    if (status.length > 0)
      throw new Error("Candidate replay checkout has tracked modifications");
    const output = await run(
      [
        "mise",
        "exec",
        "--",
        "node",
        "--experimental-strip-types",
        "scripts/replay/replay-delivery-control-plane-node.ts",
        execution.deploymentId,
        execution.workflowId,
        execution.runId,
      ],
      path.join(directory, "packages/temporal"),
    );
    const receipts = output
      .split("\n")
      .filter((line) => line.startsWith("DELIVERY_CP_REPLAY_V1="));
    if (receipts.length !== 1)
      throw new Error(
        "Candidate replay lacks its unique exact-history receipt",
      );
    const receipt = ControlPlaneReplayReceiptSchema.parse(
      JSON.parse(receipts.join("").slice("DELIVERY_CP_REPLAY_V1=".length)),
    );
    if (receipt.runId !== execution.runId)
      throw new Error(
        "Candidate replay receipt refers to a different execution run",
      );
    return receipt;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
