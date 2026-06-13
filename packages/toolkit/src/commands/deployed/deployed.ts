/**
 * `toolkit deployed` — trace a commit through the homelab deploy pipeline and
 * report, per affected service/variant, whether it's actually running on the
 * cluster. See packages/docs/guides/2026-04-06_is-commit-deployed.md.
 */
import { formatJson } from "#lib/output/formatter.ts";
import {
  repoRoot,
  fetchMain,
  resolveCommit,
  isAncestor,
  changedPackages,
  latestCommitForPackage,
  showVersionsAt,
  commitThatWroteDigest,
  isBumpSubject,
  type CommitMeta,
} from "#lib/deployed/git.ts";
import { parseVersionsFile } from "#lib/deployed/versions-file.ts";
import {
  resolveServiceSelector,
  servicesForPackages,
} from "#lib/deployed/catalog.ts";
import type {
  Service,
  Variant,
  Pin,
  DeployedReport,
  VariantReport,
  Verdict,
  ArgoStatus,
  RunningPod,
} from "#lib/deployed/types.ts";
import { getArgoApp } from "#lib/deployed/argocd.ts";
import { scanPods, podsForVersionKey } from "#lib/deployed/kubectl.ts";
import { prForCommit, openBumpPrs } from "#lib/deployed/github.ts";
import { formatReport } from "#lib/deployed/format.ts";

export type DeployedOptions = {
  selector?: string | undefined;
  commit?: string | undefined;
  json?: boolean | undefined;
  noCluster?: boolean | undefined;
  noGithub?: boolean | undefined;
};

type Target = { service: Service; variant: Variant };

function targetsFor(service: Service, variant: Variant | null): Target[] {
  const variants = variant == null ? service.variants : [variant];
  return variants.map((v) => ({ service, variant: v }));
}

/** Resolve the selector + --commit into a mode, a commit, and the targets. */
async function resolveSelection(opts: DeployedOptions): Promise<
  | {
      mode: DeployedReport["mode"];
      commit: CommitMeta;
      targets: Target[];
      notes: string[];
    }
  | { error: string }
> {
  const notes: string[] = [];
  const selection =
    opts.selector != null && opts.selector.length > 0
      ? resolveServiceSelector(opts.selector)
      : null;

  // Service-/variant-centric: selector names a known service.
  if (selection != null) {
    const { service, variant } = selection;
    const latest =
      opts.commit == null
        ? await latestCommitForPackage(service.package)
        : null;
    const commitRef = opts.commit ?? latest?.sha ?? null;
    if (commitRef == null) {
      return {
        error: `Could not find a commit for service '${service.alias}' (package packages/${service.package}).`,
      };
    }
    const commit = await resolveCommit(commitRef);
    if (commit == null) {
      return { error: `Could not resolve commit '${commitRef}'.` };
    }
    return {
      mode: variant == null ? "service" : "variant",
      commit,
      targets: targetsFor(service, variant),
      notes,
    };
  }

  // Commit-centric: selector (or --commit, or HEAD) is a git ref.
  const ref = opts.commit ?? opts.selector ?? "HEAD";
  const commit = await resolveCommit(ref);
  if (commit == null) {
    return {
      error: `'${ref}' is neither a known service nor a resolvable git ref.`,
    };
  }
  const pkgs = await changedPackages(commit.sha);
  const services = servicesForPackages(pkgs);
  const targets = services.flatMap((s) => targetsFor(s, null));
  return { mode: "commit", commit, targets, notes };
}

export function computeVerdict(args: {
  pinExists: boolean;
  writingIsBump: boolean;
  merged: boolean;
  commitInImage: boolean;
  argo: ArgoStatus | null;
  pinBuild: number | null;
  digestMatch: boolean;
}): Verdict {
  if (!args.pinExists) {
    return "UNKNOWN";
  }
  // Ladder order matters: NOT_MERGED is the most fundamental blocker, so it must
  // be reported before NO_IMAGE (a seed/placeholder pin). Otherwise an unmerged
  // commit on a never-built service would hide the more actionable "not merged".
  if (!args.merged) {
    return "NOT_MERGED";
  }
  if (!args.writingIsBump) {
    return "NO_IMAGE";
  }
  if (!args.commitInImage) {
    return "PENDING";
  }
  // commit's code IS in the pinned image.
  if (args.digestMatch) {
    return "RUNNING";
  }
  const argoAhead =
    args.argo != null &&
    args.pinBuild != null &&
    args.argo.revisionBuild != null &&
    args.argo.revisionBuild >= args.pinBuild;
  if (argoAhead) {
    return "SYNCED";
  }
  return "PINNED";
}

type PrInfo = { number: number; state: string; url: string };

/** Shared per-command context, constant across all variants. */
type EvalContext = {
  commit: CommitMeta;
  merged: boolean;
  pinsText: string | null;
  opts: DeployedOptions;
  scan: { ok: boolean; pods: RunningPod[] };
  openBumps: PrInfo[];
  pr: PrInfo | null;
};

type GitTraceResult = {
  pin: Pin | null;
  writingCommit: { sha: string; subject: string } | null;
  writingIsBump: boolean;
  commitInImage: boolean;
};

async function runGitTrace(
  variant: Variant,
  pinsText: string | null,
  commitSha: string,
): Promise<GitTraceResult> {
  const pins: Map<string, Pin> =
    pinsText == null ? new Map<string, Pin>() : parseVersionsFile(pinsText);
  const pin = pins.get(variant.versionKey) ?? null;
  if (pin == null) {
    return {
      pin: null,
      writingCommit: null,
      writingIsBump: false,
      commitInImage: false,
    };
  }
  const writingCommit = await commitThatWroteDigest(pin.digest);
  if (writingCommit == null) {
    return {
      pin,
      writingCommit: null,
      writingIsBump: false,
      commitInImage: false,
    };
  }
  return {
    pin,
    writingCommit,
    writingIsBump: isBumpSubject(writingCommit.subject),
    commitInImage: await isAncestor(commitSha, writingCommit.sha),
  };
}

async function runCluster(
  variant: Variant,
  opts: DeployedOptions,
  scan: { ok: boolean; pods: RunningPod[] },
): Promise<{ argo: ArgoStatus | null; pods: RunningPod[] }> {
  if (opts.noCluster === true) {
    return { argo: null, pods: [] };
  }
  const argoRes = await getArgoApp(variant.argoApp);
  const pods = scan.ok ? podsForVersionKey(scan.pods, variant.versionKey) : [];
  return { argo: argoRes.ok ? argoRes.status : null, pods };
}

/** Human-readable trace explanation + fix hint for the git/gh layers. */
function gitDetail(
  git: GitTraceResult,
  variant: Variant,
  verdict: Verdict,
  openBumps: PrInfo[],
): string[] {
  const { pin, writingCommit, writingIsBump } = git;
  if (pin == null) {
    return [
      `No pin for \`${variant.versionKey}\` in versions.ts — not a tracked k8s deployable.`,
    ];
  }
  const bsha = writingCommit?.sha.slice(0, 9) ?? "?";
  // Mirror the verdict ladder: NOT_MERGED outranks NO_IMAGE.
  if (verdict === "NOT_MERGED") {
    return ["Commit is not an ancestor of origin/main — not merged."];
  }
  if (!writingIsBump) {
    return [
      `Pinned digest was hand-written by ${bsha} (${writingCommit?.subject ?? "?"}), not a version bump — no real image built yet.`,
    ];
  }
  if (verdict !== "PENDING") {
    return [
      `Commit is in the pinned image ${pin.tag} (digest set by bump ${bsha}).`,
    ];
  }
  if (variant.name === "prod") {
    // prod variants are manually promoted, not auto-bumped from main.
    return [
      `Commit is merged but NOT in the prod image (${pin.tag}). prod is manually promoted — promote a newer build to ship this commit.`,
    ];
  }
  const out = [
    `Commit is merged but NOT in the pinned image (${pin.tag}, written by bump ${bsha}). It's newer than what's deployed — a build/bump is pending.`,
  ];
  const bump = openBumps[0];
  if (bump != null) {
    out.push(
      `A version-bump PR is open (#${String(bump.number)} ${bump.url}) — merge it to ship.`,
    );
  }
  return out;
}

/** Human-readable cluster (argocd/kubectl) lines. */
function clusterDetail(args: {
  git: GitTraceResult;
  verdict: Verdict;
  argo: ArgoStatus | null;
  pods: RunningPod[];
  digestMatch: boolean;
}): string[] {
  const { git, verdict, argo, pods, digestMatch } = args;
  const { pin, writingIsBump, commitInImage } = git;
  if (pin == null || !writingIsBump) {
    return [];
  }
  const out: string[] = [];
  if (argo != null) {
    out.push(
      `argocd ${argo.app}: ${argo.syncStatus} / ${argo.healthStatus}` +
        (argo.revision.length > 0 ? `, chart ${argo.revision}` : ""),
    );
  }
  const matched = pods.find((p) => p.digest === pin.digest);
  if (digestMatch && verdict === "RUNNING") {
    out.push(
      `pod ${matched?.namespace ?? ""}/${matched?.pod ?? ""} running matching digest ✅`,
    );
  } else if (digestMatch) {
    // The pinned image is live, but it's not the build containing this commit.
    out.push(
      `deployed image ${pin.tag} is live & healthy (pod ${matched?.namespace ?? ""}/${matched?.pod ?? ""}) but predates this commit.`,
    );
  } else if (pods.length > 0 && commitInImage) {
    const running = pods
      .map((p) => p.digest?.replace(/^sha256:/, "").slice(0, 10) ?? "?")
      .join(", ");
    out.push(
      `pod(s) running digest ${running} — does not match pin ${pin.digest.replace(/^sha256:/, "").slice(0, 10)} (rollout lagging?).`,
    );
  }
  return out;
}

async function evaluateTarget(
  target: Target,
  ctx: EvalContext,
): Promise<VariantReport> {
  const { service, variant } = target;
  const git = await runGitTrace(variant, ctx.pinsText, ctx.commit.sha);
  const { argo, pods } = await runCluster(variant, ctx.opts, ctx.scan);
  const digestMatch =
    git.pin != null && pods.some((p) => p.digest === git.pin?.digest);

  const verdict = computeVerdict({
    pinExists: git.pin != null,
    writingIsBump: git.writingIsBump,
    merged: ctx.merged,
    commitInImage: git.commitInImage,
    argo,
    pinBuild: git.pin?.build ?? null,
    digestMatch,
  });

  const detail = [
    ...gitDetail(git, variant, verdict, ctx.openBumps),
    ...clusterDetail({ git, verdict, argo, pods, digestMatch }),
  ];

  return {
    service: service.alias,
    variant: variant.name,
    versionKey: variant.versionKey,
    verdict,
    git: {
      pin: git.pin,
      writingCommit: git.writingCommit,
      writingCommitIsBump: git.writingIsBump,
      commitInImage: git.commitInImage,
    },
    pr: ctx.pr,
    bumpPr: ctx.openBumps[0] ?? null,
    argo,
    pods,
    digestMatch,
    detail,
  };
}

export async function deployedCommand(
  opts: DeployedOptions = {},
): Promise<void> {
  const root = await repoRoot();
  if (root == null) {
    console.error(
      "Error: `toolkit deployed` must run inside the monorepo (versions.ts not found).",
    );
    process.exit(1);
  }

  await fetchMain();

  const selection = await resolveSelection(opts);
  if ("error" in selection) {
    console.error(`Error: ${selection.error}`);
    process.exit(1);
  }

  const { mode, commit, targets, notes } = selection;
  const merged = await isAncestor(commit.sha, "origin/main");
  const pinsText = await showVersionsAt("origin/main");
  if (pinsText == null) {
    notes.push("Could not read versions.ts on origin/main.");
  }

  // Cluster + gh probes (once).
  const scan =
    opts.noCluster === true
      ? { ok: false as const, reason: "skipped (--no-cluster)" }
      : await scanPods();
  if (opts.noCluster !== true && !scan.ok) {
    notes.push(`Cluster (kubectl) unavailable: ${scan.reason}.`);
  }
  const openBumps = opts.noGithub === true ? [] : await openBumpPrs();
  // The target commit is constant across variants — look up its PR once.
  const pr =
    opts.noGithub !== true && targets.length > 0
      ? await prForCommit(commit.sha)
      : null;

  const ctx: EvalContext = {
    commit,
    merged,
    pinsText,
    opts,
    scan: scan.ok ? scan : { ok: false, pods: [] },
    openBumps,
    pr,
  };
  const variants: VariantReport[] = [];
  for (const target of targets) {
    variants.push(await evaluateTarget(target, ctx));
  }

  const report: DeployedReport = {
    commit,
    merged,
    mode,
    variants,
    notes,
  };

  if (opts.json === true) {
    console.log(formatJson(report));
  } else {
    console.log(formatReport(report));
  }

  // Exit non-zero unless every affected variant is fully RUNNING (or there's
  // nothing to deploy) — lets scripts/CI gate on it.
  const allRunning = variants.every((v) => v.verdict === "RUNNING");
  process.exit(allRunning ? 0 : 1);
}
