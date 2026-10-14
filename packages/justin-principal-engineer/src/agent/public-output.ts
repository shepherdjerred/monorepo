import type { AgentOutput } from "#src/domain/schemas.ts";
import path from "node:path";
import { z } from "zod";

/**
 * Agent output is untrusted because the prompt includes private Tracker
 * comments. Only host-authored metadata may cross into public GitHub text.
 */
export function publicAgentOutput(output: AgentOutput): AgentOutput {
  return {
    ...output,
    commitTitle: "feat(justin-principal-engineer): implement Tracker task",
    summary: "Automated implementation for the claimed Tracker task.",
    verification: [],
  };
}

export function trackerCommentBodies(trackerContext: string | null): string[] {
  const marker = "Tracker comments present for agent context:\n";
  return trackerContext?.startsWith(marker) === true
    ? trackerContext
        .slice(marker.length)
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => z.string().parse(JSON.parse(line)))
    : [];
}

export async function assertNoTrackerContextInChanges(
  checkout: string,
  paths: readonly string[],
  trackerContext: string | null,
): Promise<void> {
  if (trackerContext === null) return;
  const comments = trackerCommentBodies(trackerContext);
  for (const relativePath of paths) {
    const file = Bun.file(path.join(checkout, relativePath));
    if (!(await file.exists())) continue;
    const content = await file.text();
    const leaked = comments.find((comment) => content.includes(comment));
    if (leaked !== undefined) {
      throw new Error(
        `Changed file ${relativePath} contains Tracker-only comment content; refusing to publish`,
      );
    }
  }
}

export async function safeOutputForPublication(
  output: AgentOutput,
  input: {
    checkout: string;
    paths: readonly string[];
    trackerContext: string | null;
    hostVerification?: readonly string[];
  },
): Promise<AgentOutput> {
  const { checkout, paths, trackerContext, hostVerification = [] } = input;
  await assertNoTrackerContextInChanges(checkout, paths, trackerContext);
  return {
    ...publicAgentOutput(output),
    summary: `Updated ${String(paths.length)} files in the task branch. Host-run verification results are listed below.`,
    verification: [...hostVerification],
  };
}
