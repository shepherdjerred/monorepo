import { z } from "zod/v4";
import type { PrSummaryInput } from "#shared/schemas.ts";

const RepoContentFileSchema = z.object({
  type: z.literal("file"),
  content: z.string(),
});

export type OctokitForSummaryConventions = {
  getContent: (params: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }) => Promise<{ data: unknown }>;
};

export async function loadRepoConventionsMarkdown(
  octokit: OctokitForSummaryConventions,
  pr: PrSummaryInput,
  logWarning: (message: string, fields: Record<string, unknown>) => void,
): Promise<string> {
  const candidatePaths = ["AGENTS.md", "CLAUDE.md"];
  const errors: string[] = [];

  for (const path of candidatePaths) {
    try {
      const response = await octokit.getContent({
        owner: pr.owner,
        repo: pr.repo,
        path,
        ref: pr.commitSha,
      });
      const parsed = RepoContentFileSchema.safeParse(response.data);
      if (!parsed.success) {
        continue;
      }
      return Buffer.from(parsed.data.content, "base64").toString("utf8");
    } catch (error: unknown) {
      errors.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  logWarning("Failed to load repo instructions from PR head", {
    errors,
    prNumber: pr.prNumber,
  });
  return "";
}
