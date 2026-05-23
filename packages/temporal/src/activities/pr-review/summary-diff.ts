import type { PrSummaryInput } from "#shared/schemas.ts";
import {
  OVERSIZED_SUMMARY_FILE_THRESHOLD,
  type SummaryFile,
} from "./summary-oversized.ts";

const MAX_DIFF_BYTES = 200_000;

export type OctokitForSummaryDiff = {
  listFiles: (params: {
    owner: string;
    repo: string;
    pull_number: number;
  }) => AsyncIterable<{
    data: {
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string | null;
    }[];
  }>;
};

export type FetchedPrDiff = {
  diff: string;
  truncated: boolean;
  bytes: number;
  files: SummaryFile[];
  oversized: boolean;
};

export async function fetchPrDiff(
  octokit: OctokitForSummaryDiff,
  pr: PrSummaryInput,
): Promise<FetchedPrDiff> {
  const files: SummaryFile[] = [];
  const parts: string[] = [];
  let promptBytes = 0;
  let totalBytes = 0;
  let truncated = false;
  const iterator = octokit.listFiles({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.prNumber,
  });

  for await (const page of iterator) {
    for (const file of page.data) {
      const patch = typeof file.patch === "string" ? file.patch : null;
      const summaryFile: SummaryFile = {
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch,
      };
      files.push(summaryFile);
      if (patch === null) {
        continue;
      }
      const header = [
        `diff --git a/${file.filename} b/${file.filename}`,
        `--- a/${file.filename}`,
        `+++ b/${file.filename}`,
      ].join("\n");
      const section = `${header}\n${patch}\n`;
      const sectionBytes = Buffer.byteLength(section, "utf8");
      totalBytes += sectionBytes;
      if (promptBytes + sectionBytes > MAX_DIFF_BYTES) {
        truncated = true;
        const remainingBytes = Math.max(0, MAX_DIFF_BYTES - promptBytes);
        if (remainingBytes > 0) {
          parts.push(section.slice(0, remainingBytes));
          promptBytes = MAX_DIFF_BYTES;
        }
        continue;
      }
      parts.push(section);
      promptBytes += sectionBytes;
    }
  }

  const oversized =
    files.length > OVERSIZED_SUMMARY_FILE_THRESHOLD ||
    files.some((file) => file.patch === null);

  if (truncated) {
    parts.push(
      `\n[diff truncated at ${String(MAX_DIFF_BYTES)} bytes; ${String(files.length)} files changed]\n`,
    );
  }

  return {
    diff: parts.join("\n"),
    truncated,
    bytes: totalBytes,
    files,
    oversized,
  };
}
