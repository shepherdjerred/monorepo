import { createHash } from "node:crypto";
import { isRenovateUpdateEligible } from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { z } from "zod/v4";
import {
  openSeasonRefreshPr,
  runCommand,
} from "#activities/scout/scout-season-refresh-git.ts";
import { renovatePublishingEnabled } from "#config/renovate-publishing.ts";
import {
  executeRenovateBundle,
  type RenovateBundlePublication,
  type RenovateBundleResult,
  type VerifiedRenovateBundle,
} from "./bundle.ts";
import {
  candidatesForDispatch,
  createDispatchSave,
  isActivePublication,
  observePullRequest,
  pruneDispatch,
  reconcilePublications,
  recordDisposition,
} from "./dispatch-state.ts";
import {
  createRenovateGitHub,
  hasWoodpeckerReceipt,
  MAIN_BRANCH,
  woodpeckerAdmissionAvailable,
  type RenovateGitHub,
} from "./publication.ts";
import { createRenovateStore, type DispatchRecord } from "./store.ts";

const MAX_SCAN_AGE_MS = 36 * 60 * 60 * 1000;

const DispatchInputSchema = z.strictObject({ preview: z.boolean().optional() });
export type RenovateDispatchInput = z.infer<typeof DispatchInputSchema>;
type DispatchDependencies = {
  store?: ReturnType<typeof createRenovateStore>;
  github?: () => Promise<RenovateGitHub>;
  execute?: typeof executeRenovateBundle;
  openPr?: typeof openSeasonRefreshPr;
  verifyCommit?: typeof verifyCommittedBundle;
  hasRoom?: typeof woodpeckerAdmissionAvailable;
  hasReceipt?: typeof hasWoodpeckerReceipt;
  enabled?: typeof renovatePublishingEnabled;
  now?: () => number;
};

function cell(value: string): string {
  return value
    .replaceAll(/[\r\n]/gu, " ")
    .replaceAll("|", String.raw`\|`)
    .replaceAll("<", "&lt;")
    .replaceAll("@", "&#64;");
}

function bundleMetadata(bundle: VerifiedRenovateBundle) {
  const names = bundle.candidates
    .map(({ name }) => name.replaceAll(/[\r\n]/gu, " "))
    .join(", ");
  const title = `chore(deps): update ${names}`.slice(0, 180);
  const identity = JSON.stringify([
    bundle.baseSha,
    bundle.diffSha256,
    bundle.candidateIds.toSorted(),
  ]);
  const branch = `chore/renovate-bundle-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
  const table = bundle.candidates.flatMap(({ targets }) =>
    targets.map((target) => {
      const before =
        target.currentDigest ?? target.currentValue ?? "unresolved";
      return `| ${cell(target.packageName)} | ${cell(before)} | ${cell(target.digest ?? target.targetValue)} | ${cell(target.filePath)} |`;
    }),
  );
  const body = [
    "## Why",
    ...bundle.candidates.map(
      ({ name, rationale }) => `- ${cell(name)} — ${cell(rationale)}`,
    ),
    "\n## What",
    "| Dependency | Before | After | Location |",
    "| --- | --- | --- | --- |",
    ...table,
    "\n## Demo",
    bundle.demo,
    "\n## Verification",
    bundle.verificationSummary,
  ].join("\n");
  return { branch, title, body };
}

async function verifyCommittedBundle(
  bundle: VerifiedRenovateBundle,
  sha: string,
): Promise<void> {
  const diff = await runCommand(
    [
      "git",
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      bundle.baseSha,
      sha,
      "--",
    ],
    { cwd: bundle.repoDir, signal: bundle.signal },
  );
  if (createHash("sha256").update(diff).digest("hex") !== bundle.diffSha256) {
    throw new Error(
      "The prepared commit no longer matches the verified bundle diff",
    );
  }
}

async function admissionHold(input: {
  preview: boolean;
  enabled: boolean;
  awaitingReceipt: boolean;
  candidates: number;
  hasRoom: typeof woodpeckerAdmissionAvailable;
}): Promise<string | undefined> {
  if (input.preview || input.candidates === 0) return;
  if (!input.enabled) return "Publishing is paused by the Temporal flag.";
  if (input.awaitingReceipt)
    return "Waiting for Woodpecker to acknowledge a previously submitted bundle.";
  return (await input.hasRoom()) ? undefined : "Woodpecker is at capacity.";
}

type PublishContext = {
  record: DispatchRecord;
  save: () => Promise<void>;
  clock: () => number;
  github: RenovateGitHub;
  canPublish: () => Promise<boolean>;
  openPr: typeof openSeasonRefreshPr;
  verifyCommit: typeof verifyCommittedBundle;
};

async function publishVerifiedBundle(
  ctx: PublishContext,
  bundle: VerifiedRenovateBundle,
): Promise<RenovateBundlePublication> {
  const { github, record, clock, save } = ctx;
  if (!(await ctx.canPublish()))
    return {
      status: "queued",
      reason:
        "Publishing is paused or Woodpecker reached capacity during verification.",
    };
  if ((await github.branchHead(MAIN_BRANCH)) !== bundle.baseSha)
    return {
      status: "queued",
      reason:
        "Main changed during verification. The bundle will be reverified.",
    };
  const open = await github.openWorkPaths();
  if (bundle.changedFiles.some((path) => open.has(path)))
    return {
      status: "queued",
      reason: "Open work overlaps the verified bundle.",
    };
  const metadata = bundleMetadata(bundle);
  if ((await github.branchHead(metadata.branch)) !== undefined)
    return {
      status: "queued",
      reason:
        "The exact bundle branch already exists. Inspect its publication receipt.",
    };
  const opened = await ctx.openPr({
    ...metadata,
    commitBody: metadata.body,
    repoDir: bundle.repoDir,
    tempDir: bundle.tempDir,
    files: bundle.changedFiles,
    ghToken: github.token,
    repoSlug: github.slug,
    mainBranch: MAIN_BRANCH,
    signal: bundle.signal,
    beforePush: async (headSha) => {
      await ctx.verifyCommit(bundle, headSha);
      if (
        !(await ctx.canPublish()) ||
        (await github.branchHead(MAIN_BRANCH)) !== bundle.baseSha
      ) {
        throw new Error("Dependency bundle admission changed before push");
      }
      record.value.publications[metadata.branch] = {
        ...metadata,
        headSha,
        baseSha: bundle.baseSha,
        plannedAt: new Date(clock()).toISOString(),
        files: [...bundle.changedFiles],
        candidates: bundle.candidates,
        woodpeckerSeen: false,
      };
      await save();
    },
  });
  const publication = record.value.publications[metadata.branch];
  if (publication?.headSha !== opened.commitHash)
    throw new Error("GitHub published without a matching bundle intent");
  const pr = await github.findPullRequest(publication);
  if (pr?.url !== opened.prUrl || pr.headSha !== opened.commitHash)
    throw new Error("Matching bundle PR readback is pending");
  observePullRequest(record, publication, pr, clock());
  await save();
  return {
    status: "published",
    prUrl: pr.url,
    prNumber: pr.number,
    headSha: pr.headSha,
  };
}

function recordAttempt(
  record: DispatchRecord,
  result: RenovateBundleResult,
  now: number,
): void {
  for (const disposition of result.dispositions) {
    recordDisposition(
      record,
      disposition.id,
      {
        status: disposition.status === "reserved" ? "queued" : "blocked",
        reason: disposition.reason,
        ...(disposition.status === "oversized" ? { revisedEffort: "l" } : {}),
      },
      now,
    );
  }
  if (result.publication?.status !== "queued") return;
  for (const id of result.candidateIds)
    recordDisposition(
      record,
      id,
      { status: "queued", reason: result.publication.reason },
      now,
    );
}

function dispatchServices(deps: DispatchDependencies) {
  return {
    clock: deps.now ?? Date.now,
    store: deps.store ?? createRenovateStore(),
    connectGitHub: deps.github ?? createRenovateGitHub,
    execute: deps.execute ?? executeRenovateBundle,
    openPr: deps.openPr ?? openSeasonRefreshPr,
    verifyCommit: deps.verifyCommit ?? verifyCommittedBundle,
    hasRoom: deps.hasRoom ?? woodpeckerAdmissionAvailable,
    hasReceipt: deps.hasReceipt ?? hasWoodpeckerReceipt,
    isEnabled: deps.enabled ?? renovatePublishingEnabled,
  };
}

export async function dispatchRenovateBundle(
  request: RenovateDispatchInput = {},
  deps: DispatchDependencies = {},
) {
  const preview = DispatchInputSchema.parse(request).preview === true;
  const {
    clock,
    store,
    connectGitHub,
    execute,
    openPr,
    verifyCommit,
    hasRoom,
    hasReceipt,
    isEnabled,
  } = dispatchServices(deps);
  const now = clock();
  const [snapshot, record] = await Promise.all([
    store.readRanking(),
    store.readDispatch(),
  ]);
  const fresh =
    snapshot !== undefined &&
    now - Date.parse(snapshot.scannedAt) <= MAX_SCAN_AGE_MS;
  const enabled = !preview && (await isEnabled());
  const canPublish = async () => (await isEnabled()) && (await hasRoom());
  const activePublications = Object.values(record.value.publications).some(
    (publication) => isActivePublication(publication),
  );
  const hasCandidates =
    fresh && candidatesForDispatch(snapshot, record, now).length > 0;
  const needsGitHub =
    !preview && (activePublications || (enabled && hasCandidates));
  const github = needsGitHub ? await connectGitHub() : undefined;
  const save = createDispatchSave(store, record, preview);
  const awaitingReceipt =
    github === undefined
      ? false
      : await reconcilePublications({
          record,
          github,
          canPublish,
          stillEligible: (publication) =>
            fresh &&
            publication.candidates.every(({ id }) =>
              snapshot.candidates.some(
                (candidate) =>
                  candidate.id === id &&
                  isRenovateUpdateEligible(candidate, now),
              ),
            ),
          hasReceipt,
          now,
          save,
        });
  if (!fresh) {
    await save();
    return { outcome: "no-fresh-ranking" as const };
  }
  pruneDispatch(record, snapshot, now);
  const candidates = candidatesForDispatch(snapshot, record, now);
  const hold = await admissionHold({
    preview,
    enabled,
    awaitingReceipt,
    candidates: candidates.length,
    hasRoom,
  });
  if (hold !== undefined) {
    for (const { id } of candidates)
      recordDisposition(record, id, { status: "queued", reason: hold }, now);
    await save();
    return { outcome: "queued" as const, reason: hold };
  }
  if (candidates.length === 0) {
    await save();
    return { outcome: "idle" as const };
  }
  const reservedPaths = (await github?.openWorkPaths()) ?? new Set<string>();
  const result = await execute(
    {
      candidates,
      reservedPaths: [...reservedPaths],
      rankedBaseSha: snapshot.baseSha,
    },
    (bundle) => {
      if (github === undefined)
        return Promise.resolve({
          status: "queued",
          reason: "Preview verified the bundle locally.",
        });
      return publishVerifiedBundle(
        {
          record,
          save,
          clock,
          github,
          canPublish,
          openPr,
          verifyCommit,
        },
        bundle,
      );
    },
  );
  recordAttempt(record, result, clock());
  await save();
  return {
    outcome: preview ? ("preview" as const) : ("processed" as const),
    result,
  };
}
