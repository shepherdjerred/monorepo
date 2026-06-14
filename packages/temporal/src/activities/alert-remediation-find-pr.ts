import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { parseJsonArray } from "#shared/json.ts";
import {
  alertRemediationWorkflowId,
  type AlertRemediationSweepInput,
  type NormalizedAlert,
} from "#shared/alert-remediation.ts";
import { defaultAlertRemediationDeps } from "./alert-remediation-runtime.ts";

const OpenPrCliSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    url: z.url(),
    isDraft: z.boolean().optional(),
    headRefName: z.string().optional(),
    body: z.string().nullable().optional(),
  })
  .loose();

export type FindExistingAlertRemediationPrInput = {
  alert: NormalizedAlert;
  repo: AlertRemediationSweepInput["repo"];
};

export type FindExistingAlertRemediationPrResult =
  | {
      found: false;
    }
  | {
      found: true;
      prUrl: string;
      branchName: string | undefined;
      title: string;
    };

export async function findExistingPr(
  input: FindExistingAlertRemediationPrInput,
): Promise<FindExistingAlertRemediationPrResult> {
  const tokenResult = await createGitHubAppInstallationToken();
  const branchName = alertRemediationWorkflowId(input.alert);
  const raw = await defaultAlertRemediationDeps.runCommand({
    command: [
      "gh",
      "pr",
      "list",
      "--repo",
      input.repo.fullName,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,url,isDraft,headRefName,body",
    ],
    cwd: "/tmp",
    env: { GH_TOKEN: tokenResult.token },
    redactOutput: true,
  });
  return existingPrFromSearch(raw, {
    fingerprint: input.alert.fingerprint,
    branchName,
  });
}

export function existingPrFromSearch(
  raw: string,
  needle?: { fingerprint: string; branchName: string },
): FindExistingAlertRemediationPrResult {
  const prs = parseJsonArray(raw, OpenPrCliSchema, "GitHub PR list");
  const pr =
    needle === undefined
      ? prs[0]
      : prs.find(
          (candidate) =>
            candidate.headRefName === needle.branchName ||
            candidate.body?.includes(needle.fingerprint) === true ||
            candidate.title.includes(needle.fingerprint),
        );
  if (pr === undefined) {
    return { found: false };
  }
  return {
    found: true,
    prUrl: pr.url,
    branchName: pr.headRefName,
    title: pr.title,
  };
}
