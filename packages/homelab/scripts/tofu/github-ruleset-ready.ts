#!/usr/bin/env bun

/**
 * Hold the one-time required-check switch until Woodpecker has completed a
 * real PR. Include merged PRs: the proof remains valid after the PR closes,
 * and the first main build may finish after that merge.
 */

import { z } from "zod";

const PullsSchema = z.array(
  z.object({ head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/u) }) }),
);
const StatusesSchema = z.object({
  statuses: z.array(
    z.object({
      context: z.string(),
      state: z.string(),
      target_url: z.string().nullable(),
    }),
  ),
});

async function githubJson(url: URL, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub ruleset-readiness read failed: HTTP ${response.status.toString()}`,
    );
  }
  return response.json();
}

function fromWoodpeckerPipeline(target: string | null): boolean {
  if (target === null) return false;
  const url = URL.parse(target);
  return (
    url?.origin === "https://woodpecker.sjer.red" &&
    /^\/repos\/\d+\/pipeline\/\d+\/\d+$/u.test(url.pathname)
  );
}

export async function hasLiveCompletionStatus(token: string): Promise<boolean> {
  for (let page = 1; page <= 10; page++) {
    const pullsUrl = new URL(
      `https://api.github.com/repos/shepherdjerred/monorepo/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page.toString()}`,
    );
    const pulls = PullsSchema.parse(await githubJson(pullsUrl, token));
    for (const pull of pulls) {
      const statusUrl = new URL(
        `https://api.github.com/repos/shepherdjerred/monorepo/commits/${pull.head.sha}/status`,
      );
      statusUrl.searchParams.set("per_page", "100");
      const statuses = StatusesSchema.parse(await githubJson(statusUrl, token));
      if (
        statuses.statuses.some(
          (status) =>
            status.context === "ci/woodpecker/pr/ci-complete" &&
            status.state === "success" &&
            fromWoodpeckerPipeline(status.target_url),
        )
      ) {
        return true;
      }
    }
    if (pulls.length < 100) return false;
  }
  throw new Error(
    "More than 1000 open PRs; cannot establish ruleset readiness",
  );
}

if (import.meta.main) {
  const token = Bun.env["GITHUB_DOWNLOAD_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error("GITHUB_DOWNLOAD_TOKEN is required");
  }
  const ready = await hasLiveCompletionStatus(token);
  console.log(ready ? "ready" : "deferred");
}
