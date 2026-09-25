import type { AgentOutput } from "#src/domain/schemas.ts";
import path from "node:path";
import { z } from "zod";

/**
 * Agent output is untrusted because the prompt includes private Linear
 * comments. Only host-authored metadata may cross into public GitHub text.
 */
export function publicAgentOutput(output: AgentOutput): AgentOutput {
  return {
    ...output,
    commitTitle: "feat(justin-principal-engineer): implement Linear task",
    summary: "Automated implementation for the claimed Linear task.",
    verification: [],
  };
}

export function linearCommentBodies(linearContext: string | null): string[] {
  const marker = "Linear comments present for agent context:\n";
  return linearContext?.startsWith(marker) === true
    ? linearContext
        .slice(marker.length)
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => z.string().parse(JSON.parse(line)))
    : [];
}

export async function assertNoLinearContextInChanges(
  checkout: string,
  paths: readonly string[],
  linearContext: string | null,
): Promise<void> {
  if (linearContext === null) return;
  const comments = linearCommentBodies(linearContext);
  for (const relativePath of paths) {
    const file = Bun.file(path.join(checkout, relativePath));
    if (!(await file.exists())) continue;
    const content = await file.text();
    const leaked = comments.find((comment) => content.includes(comment));
    if (leaked !== undefined) {
      throw new Error(
        `Changed file ${relativePath} contains Linear-only comment content; refusing to publish`,
      );
    }
  }
}

export async function safeOutputForPublication(
  output: AgentOutput,
  checkout: string,
  paths: readonly string[],
  linearContext: string | null,
): Promise<AgentOutput> {
  await assertNoLinearContextInChanges(checkout, paths, linearContext);
  return publicAgentOutput(output);
}
