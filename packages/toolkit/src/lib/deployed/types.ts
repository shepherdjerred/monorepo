/**
 * Types for the `toolkit deployed` command — tracing a commit through the
 * homelab deployment pipeline (git → version bump → versions.ts → ArgoCD → pod).
 */

/** A single deployable variant of a service (e.g. scout beta vs prod). */
export type Variant = {
  /** Variant label: "default" for single-variant services, else "beta"/"prod". */
  name: string;
  /** Key in versions.ts, e.g. "shepherdjerred/scout-for-lol/beta". */
  versionKey: string;
  /** ArgoCD application that deploys this variant, e.g. "scout-beta". */
  argoApp: string;
};

/** A deployable service (image) and its variants. */
export type Service = {
  /** Short alias used on the CLI, e.g. "scout". */
  alias: string;
  /** Workspace package directory under packages/, e.g. "scout-for-lol". */
  package: string;
  variants: Variant[];
};

/** A pinned image reference parsed out of versions.ts. */
export type Pin = {
  versionKey: string;
  /** Build number portion of the "2.0.0-<build>" tag. */
  build: number;
  /** Full tag string "2.0.0-<build>". */
  tag: string;
  /** "sha256:..." image digest. */
  digest: string;
};

/**
 * Where a variant sits for the target commit (furthest rung reached):
 * - RUNNING    commit's code is in the pinned image AND a pod runs that digest
 * - SYNCED     commit in pinned image, ArgoCD chart ≥ pin build, pod unconfirmed
 * - PINNED     commit in pinned image on main, cluster state unknown/lagging
 * - PENDING    commit merged but newer than the pinned image (build/bump pending)
 * - NO_IMAGE   pin is a seed/placeholder; no real image ever built+bumped
 * - NOT_MERGED commit is not on main
 * - UNKNOWN    no pin for this versionKey, or the git layer failed
 */
export type Verdict =
  | "NOT_MERGED"
  | "NO_IMAGE"
  | "PENDING"
  | "PINNED"
  | "SYNCED"
  | "RUNNING"
  | "UNKNOWN";

/** Result of the git-only trace layer for one variant. */
export type GitTrace = {
  pin: Pin | null;
  /** Commit that wrote the current pinned digest into versions.ts. */
  writingCommit: { sha: string; subject: string } | null;
  /** True when that writing commit is a "bump image versions" commit. */
  writingCommitIsBump: boolean;
  /** True when the target commit is an ancestor of the writing commit. */
  commitInImage: boolean;
};

/** ArgoCD application status for a variant's app. */
export type ArgoStatus = {
  app: string;
  syncStatus: string;
  healthStatus: string;
  /** Synced Helm chart revision string, e.g. "2.0.0-3659". */
  revision: string;
  /** Build number parsed from the revision, if it matches the 2.0.0-<n> shape. */
  revisionBuild: number | null;
};

/** A running pod observed via kubectl, matched to a versionKey. */
export type RunningPod = {
  namespace: string;
  pod: string;
  container: string;
  /** Container spec image (may be a bare config sha on some runtimes). */
  image: string;
  /** Full "<repo>@sha256:..." pulled image reference. */
  imageID: string;
  /** "sha256:..." digest extracted from imageID. */
  digest: string | null;
};

/** Full per-variant report. */
export type VariantReport = {
  service: string;
  variant: string;
  versionKey: string;
  verdict: Verdict;
  git: GitTrace;
  /** PR for the target commit, when discoverable via gh. */
  pr: { number: number; state: string; url: string } | null;
  /** Version-bump PR state, when a bump PR is open for the target build. */
  bumpPr: { number: number; state: string; url: string } | null;
  argo: ArgoStatus | null;
  pods: RunningPod[];
  /** True when a running pod's digest matches the pinned digest. */
  digestMatch: boolean;
  /** Human-readable explanation + fix hint for the current verdict. */
  detail: string[];
};

/** Top-level command report. */
export type DeployedReport = {
  commit: { sha: string; shortSha: string; subject: string };
  merged: boolean;
  /** How the selector was interpreted. */
  mode: "commit" | "service" | "variant";
  variants: VariantReport[];
  /** Notes about degraded layers (missing argocd/kubectl/gh, etc.). */
  notes: string[];
};
