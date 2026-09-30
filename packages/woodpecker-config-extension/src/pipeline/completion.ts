import type { CiStep } from "#src/pipeline/model.ts";
import { LIGHT_TIER } from "#src/pipeline/tiers.ts";
import { shellQuote } from "#src/pipeline/emit.ts";

/**
 * GitHub receives a status for each Woodpecker workflow, not for the whole PR.
 * Keep the required verdict in the trusted configuration extension, without
 * cloning PR-controlled code into the completion workflow.
 */
export const CHECK_STATUSES = `
const expected = JSON.parse(process.env.CI_EXPECTED_CONTEXTS);
const pipeline = process.env.CI_PIPELINE_URL;
const repository = process.env.CI_REPO;
const commit = process.env.CI_COMMIT_SHA;
const token = process.env.GITHUB_DOWNLOAD_TOKEN;
if (!pipeline || !repository || !commit || !token || !Array.isArray(expected) || expected.length === 0) {
  throw new Error("missing completion-check input");
}
const url = new URL("https://api.github.com/repos/" + repository + "/commits/" + commit + "/status");
url.searchParams.set("per_page", "100");
for (let attempt = 0; attempt < 20; attempt++) {
  const response = await fetch(url, {
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error("GitHub status read failed: HTTP " + response.status);
  const result = await response.json();
  if (!Array.isArray(result.statuses)) throw new Error("GitHub returned no status list");
  const current = new Map(result.statuses
    .filter((status) => typeof status.target_url === "string" && status.target_url.startsWith(pipeline + "/"))
    .map((status) => [status.context, status.state]));
  const failed = expected.filter((context) => ["failure", "error"].includes(current.get(context)));
  if (failed.length > 0) throw new Error("Required workflows failed: " + failed.join(", "));
  const incomplete = expected.filter((context) => current.get(context) !== "success");
  if (incomplete.length === 0) {
    console.log("All " + expected.length + " required workflows passed in this pipeline");
    process.exit(0);
  }
  if (attempt === 19) throw new Error("Required workflows have no completed status: " + incomplete.join(", "));
  await Bun.sleep(3000);
}
`;

export function completionStep(
  selected: readonly CiStep[],
  image: string,
): CiStep {
  const blocking = selected.filter((step) => step.allowFailure !== true);
  if (blocking.length === 0) {
    throw new Error("a PR must select at least one blocking workflow");
  }
  return {
    key: "ci-complete",
    label: "complete required PR checks",
    image,
    // skip_clone leaves Woodpecker's workspace without the repo's .mise.toml.
    // The CI image keeps that pinned toolchain at /workspace.
    commands: ["cd /workspace", `bun -e ${shellQuote(CHECK_STATUSES)}`],
    environment: {
      CI_EXPECTED_CONTEXTS: JSON.stringify(
        blocking.map((step) => `ci/woodpecker/pr/${step.key}`),
      ),
    },
    dependsOn: blocking.map((step) => step.key),
    timeoutMinutes: 3,
    resources: LIGHT_TIER,
    skipClone: true,
    runOnFailure: true,
    secrets: [
      {
        secret: "ci-github-credentials",
        key: "GITHUB_DOWNLOAD_TOKEN",
        env: "GITHUB_DOWNLOAD_TOKEN",
      },
    ],
  };
}

export function noWorkStep(image: string): CiStep {
  return {
    key: "ci-noop",
    label: "no CI work for this event",
    image,
    commands: ["echo 'No CI work for this event'"],
    timeoutMinutes: 1,
    resources: LIGHT_TIER,
    skipClone: true,
  };
}
