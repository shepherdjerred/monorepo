import type { CiStep } from "#src/pipeline/model.ts";
import { GATE_TIER, LIGHT_TIER } from "#src/pipeline/tiers.ts";
import { shellQuote } from "#src/pipeline/emit.ts";

/**
 * GitHub receives a status for each Woodpecker workflow, not for the whole PR.
 * Keep the required verdict in the trusted configuration extension, without
 * cloning PR-controlled code into the completion workflow.
 */
export const CHECK_STATUSES = String.raw`
const expected = JSON.parse(process.env.CI_EXPECTED_CONTEXTS);
const pipeline = process.env.CI_PIPELINE_URL;
const repository = process.env.CI_REPO;
const commit = process.env.CI_COMMIT_SHA;
const token = process.env.GITHUB_DOWNLOAD_TOKEN;
if (!pipeline || !repository || !commit || !token || !Array.isArray(expected) || expected.length === 0) {
  throw new Error("missing completion-check input");
}
const headers = {
  authorization: "Bearer " + token,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};
const TERMINAL_DESCRIPTIONS = [
  "Pipeline was canceled",
  "Pipeline was skipped",
  "Pipeline was rejected",
];
const ACTIVE_PENDING_DESCRIPTIONS = [
  "Pipeline is pending",
  "Pipeline is running",
];
const TERMINAL_WOODPECKER_STATES = [
  "failure",
  "error",
  "killed",
  "canceled",
  "cancelled",
  "skipped",
  "declined",
];
const MISSING_POLL_MS = 3000;
const MISSING_TIMEOUT_MS = 60_000;
const PENDING_POLL_MS = 10_000;
const PENDING_TIMEOUT_MS = 5_400_000;
const pageCache = new Map();
function parsePipelineRef(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const match = /^\/repos\/(\d+)\/pipeline\/(\d+)\/?$/u.exec(parsed.pathname);
    if (!match) return null;
    return { origin: parsed.origin, repoId: match[1], pipelineNumber: match[2] };
  } catch {
    return null;
  }
}
const pipelineRef = parsePipelineRef(pipeline);
async function reconcileFromWoodpecker(incompleteContexts) {
  if (!pipelineRef) return null;
  try {
    const url =
      pipelineRef.origin +
      "/api/repos/" +
      pipelineRef.repoId +
      "/pipelines/" +
      pipelineRef.pipelineNumber;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const data = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      data.number !== Number(pipelineRef.pipelineNumber) ||
      data.commit !== commit ||
      !Array.isArray(data.workflows)
    ) {
      return null;
    }
    const byName = new Map();
    for (const wf of data.workflows) {
      if (!wf || typeof wf.name !== "string" || typeof wf.state !== "string") continue;
      const states = byName.get(wf.name) ?? [];
      states.push(wf.state);
      byName.set(wf.name, states);
    }
    const failedContexts = [];
    for (const context of expected) {
      const wfName = context.split("/").slice(3).join("/");
      const states = byName.get(wfName) ?? [];
      if (states.some((state) => TERMINAL_WOODPECKER_STATES.includes(state))) {
        failedContexts.push(context);
      }
    }
    if (failedContexts.length > 0) {
      return { failed: failedContexts, remaining: incompleteContexts };
    }
    const remaining = incompleteContexts.filter((context) => {
      const wfName = context.split("/").slice(3).join("/");
      const states = byName.get(wfName) ?? [];
      return !(states.length > 0 && states.every((state) => state === "success"));
    });
    return { failed: [], remaining };
  } catch {
    return null;
  }
}
// Combined /status stops at 100 contexts. The list endpoint is newest-first
// and paginated; the first state we see for a context is the current one.
async function statusesForPipeline() {
  const latest = new Map();
  let next = "https://api.github.com/repos/" + repository + "/commits/" + commit + "/statuses?per_page=100";
  while (next) {
    const cached = pageCache.get(next);
    const requestHeaders = cached?.etag ? { ...headers, "if-none-match": cached.etag } : headers;
    const response = await fetch(next, { headers: requestHeaders });
    let page;
    let link;
    if (response.status === 304) {
      if (!cached) throw new Error("GitHub returned HTTP 304 without cached status page");
      page = cached.page;
      link = response.headers.get("link") ?? cached.link;
    } else {
      if (!response.ok) throw new Error("GitHub status read failed: HTTP " + response.status);
      page = await response.json();
      if (!Array.isArray(page)) throw new Error("GitHub returned no status list");
      link = response.headers.get("link") ?? "";
      const etag = response.headers.get("etag") ?? "";
      if (etag) pageCache.set(next, { etag, page, link });
    }
    for (const status of page) {
      if (typeof status.context !== "string") continue;
      if (typeof status.target_url !== "string" || !status.target_url.startsWith(pipeline + "/")) continue;
      if (latest.has(status.context)) continue;
      latest.set(status.context, {
        state: typeof status.state === "string" ? status.state : "",
        description: typeof status.description === "string" ? status.description : "",
      });
    }
    const match = /<([^>]+)>;\s*rel="next"/u.exec(link);
    next = match?.[1] ?? "";
  }
  return latest;
}
let elapsedMs = 0;
let missingMs = 0;
while (true) {
  const current = await statusesForPipeline();
  const failed = expected.filter((context) => {
    const entry = current.get(context);
    return (
      entry !== undefined &&
      (["failure", "error"].includes(entry.state) ||
        TERMINAL_DESCRIPTIONS.includes(entry.description))
    );
  });
  if (failed.length > 0) throw new Error("Required workflows failed: " + failed.join(", "));
  const incomplete = expected.filter((context) => current.get(context)?.state !== "success");
  if (incomplete.length === 0) {
    console.log("All " + expected.length + " required workflows passed in this pipeline");
    process.exit(0);
  }
  const allActivelyPending = incomplete.every((context) => {
    const entry = current.get(context);
    return (
      entry !== undefined &&
      entry.state === "pending" &&
      ACTIVE_PENDING_DESCRIPTIONS.includes(entry.description)
    );
  });
  const hasNonActivePending = incomplete.some((context) => {
    const entry = current.get(context);
    return (
      entry !== undefined &&
      entry.state === "pending" &&
      !ACTIVE_PENDING_DESCRIPTIONS.includes(entry.description)
    );
  });
  if (allActivelyPending) {
    missingMs = 0;
    if (elapsedMs >= PENDING_TIMEOUT_MS) {
      const reconciled = await reconcileFromWoodpecker(incomplete);
      if (reconciled?.failed.length) {
        throw new Error("Required workflows failed: " + reconciled.failed.join(", "));
      }
      if (reconciled && reconciled.remaining.length === 0) {
        console.log("All " + expected.length + " required workflows passed in this pipeline");
        process.exit(0);
      }
      throw new Error(
        "Required workflows have no completed status: " +
          (reconciled ? reconciled.remaining : incomplete).join(", "),
      );
    }
    const delayMs = Math.min(PENDING_POLL_MS, PENDING_TIMEOUT_MS - elapsedMs);
    await Bun.sleep(delayMs);
    elapsedMs += delayMs;
  } else {
    if (hasNonActivePending || missingMs >= MISSING_TIMEOUT_MS || elapsedMs >= PENDING_TIMEOUT_MS) {
      const reconciled = await reconcileFromWoodpecker(incomplete);
      if (reconciled?.failed.length) {
        throw new Error("Required workflows failed: " + reconciled.failed.join(", "));
      }
      if (reconciled && reconciled.remaining.length === 0) {
        console.log("All " + expected.length + " required workflows passed in this pipeline");
        process.exit(0);
      }
      if (missingMs >= MISSING_TIMEOUT_MS || elapsedMs >= PENDING_TIMEOUT_MS) {
        throw new Error(
          "Required workflows have no completed status: " +
            (reconciled ? reconciled.remaining : incomplete).join(", "),
        );
      }
    }
    const delayMs = Math.min(
      MISSING_POLL_MS,
      MISSING_TIMEOUT_MS - missingMs,
      PENDING_TIMEOUT_MS - elapsedMs,
    );
    await Bun.sleep(delayMs);
    missingMs += delayMs;
    elapsedMs += delayMs;
  }
}
`;

export function completionStep(
  selected: readonly CiStep[],
  image: string,
  workingDirectory: "/workspace" | "/app" = "/workspace",
  event: "pull_request" | "pull_request_metadata" = "pull_request",
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
    commands: [
      `cd ${workingDirectory}`,
      `bun -e ${shellQuote(CHECK_STATUSES)}`,
    ],
    environment: {
      CI_EXPECTED_CONTEXTS: JSON.stringify(
        blocking.map(
          (step) =>
            `ci/woodpecker/${event === "pull_request" ? "pr" : event}/${step.key}`,
        ),
      ),
    },
    dependsOn: blocking.map((step) => step.key),
    timeoutMinutes: 95,
    resources: workingDirectory === "/app" ? GATE_TIER : LIGHT_TIER,
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

/**
 * A clone-free, tokenless receipt for a manual request that selected no work.
 *
 * Events that select nothing (tags, feature-branch pushes, closed pull
 * requests, ordinary PR metadata edits) no longer emit this: `app.ts` returns
 * an empty configuration set and Woodpecker records no pipeline at all. It
 * remains the shape of the maintenance `superseded` and `unverified` receipts
 * (`maintenance.ts`) and the extended tier's `superseded` receipt
 * (`extended.ts`), whose Temporal dispatchers read the finished workflow.
 */
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
