import path from "node:path";

/**
 * Decisions for copying a stage's published report-lake build to this machine.
 *
 * Split from the script that shells out for the same reason `dev-db-pull` is:
 * everything here is a choice that can be wrong — which pod, which directory,
 * which build — and a choice that can be wrong deserves a test.
 *
 * The lake is copied rather than rebuilt because a published build is what the
 * deployed backend is actually answering from, and rebuilding from S3 takes
 * tens of minutes. Build directories are immutable once published, so copying
 * one out of a running pod is safe even while the compactor is working on the
 * next.
 */

export type DevLakePullStage = "beta" | "prod";

export type LakeStageTarget = {
  readonly namespace: string;
  /**
   * Selects the backend pod that owns the lake PVC.
   *
   * `app=scout-backend` is set deliberately in the chart
   * (`homelab .../resources/scout/index.ts:63`) so the namespace
   * NetworkPolicies select only the backend; a looser selector here would also
   * match the Patroni/Spilo postgres pods, which hold no lake.
   */
  readonly selector: string;
  readonly lakeDir: string;
};

export const LAKE_STAGES: Readonly<Record<DevLakePullStage, LakeStageTarget>> =
  {
    beta: {
      namespace: "scout-beta",
      selector: "app=scout-backend",
      lakeDir: "/data/report-lake",
    },
    prod: {
      namespace: "scout-prod",
      selector: "app=scout-backend",
      lakeDir: "/data/report-lake",
    },
  };

export type DevLakePullOptions = {
  readonly stage: DevLakePullStage;
  readonly target: LakeStageTarget;
  /** Where the copied lake lands; also what `REPORT_LAKE_DIR` must be set to. */
  readonly destination: string;
  /** Staging directory, renamed into place once the copy is complete. */
  readonly staging: string;
};

export type DevLakePullParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: DevLakePullOptions };

export const USAGE = `Usage: bun run dev:lake-pull -- [options]

Copies a hosted Scout report-lake build onto this machine, for the Explore
replay eval to read. Only the published build is copied, never the staging
NDJSON: a replay must read a frozen dataset.

Options:
  --stage <beta|prod>   Source stage (default: beta)
  --destination <path>  Where to put the lake (default: under XDG_DATA_HOME)
  --help                Show this help

Pull the lake BEFORE the database. The lake's accounts are derived from
Postgres, so a database captured afterwards is a superset of the identities the
lake references; the other order can leave lake rows pointing at accounts the
snapshot has never heard of.`;

/** `<data>/scout-for-lol/stage-dataset/<stage>/report-lake`. */
export function defaultLakeDestination(
  stage: DevLakePullStage,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const dataHome =
    environment["XDG_DATA_HOME"] ??
    path.join(environment["HOME"] ?? "/tmp", ".local", "share");
  return path.join(
    dataHome,
    "scout-for-lol",
    "stage-dataset",
    stage,
    "report-lake",
  );
}

/** Where the dataset pin for this stage lives, beside the lake it describes. */
export function datasetPinPath(
  stage: DevLakePullStage,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return path.join(
    path.dirname(defaultLakeDestination(stage, environment)),
    "dataset.json",
  );
}

function parseStage(value: string): DevLakePullStage {
  if (value === "beta" || value === "prod") return value;
  throw new Error(`--stage must be beta or prod, got ${value}`);
}

/**
 * Reasons this destination must not be written to.
 *
 * The copy removes its destination before renaming the staged tree into place,
 * so an unconsidered path here deletes a directory nobody asked it to touch.
 * The same reasoning as `assertSafeLakeTarget` in `dev-lake-seed.ts`, applied
 * at the point the path is chosen rather than the point it is used.
 */
export function lakeDestinationIssues(destination: string): readonly string[] {
  const issues: string[] = [];
  if (!path.isAbsolute(destination)) {
    issues.push(`destination must be absolute, got ${destination}`);
  }
  const resolved = path.resolve(destination);
  if (resolved === path.parse(resolved).root) {
    issues.push("destination must not be the filesystem root");
  }
  if (resolved.split(path.sep).filter(Boolean).length < 2) {
    issues.push(`destination is suspiciously shallow: ${resolved}`);
  }
  if (path.basename(resolved) !== "report-lake") {
    // Refuses to delete a directory that was never a lake — the case where a
    // mistyped flag points at something else entirely.
    issues.push(
      `destination must be named report-lake so a mistyped path cannot be deleted, got ${path.basename(resolved)}`,
    );
  }
  return issues;
}

export function parseDevLakePullArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): DevLakePullParseResult {
  let stage: DevLakePullStage = "beta";
  let destination: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      return { kind: "help" };
    }
    if (argument === "--stage") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--stage requires a value");
      stage = parseStage(value);
      index += 1;
      continue;
    }
    if (argument === "--destination") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--destination requires a value");
      }
      destination = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument ?? ""}`);
  }

  const resolved = path.resolve(
    destination ?? defaultLakeDestination(stage, environment),
  );
  const issues = lakeDestinationIssues(resolved);
  if (issues.length > 0) {
    throw new Error(`Refusing to use this destination: ${issues.join("; ")}`);
  }

  return {
    kind: "options",
    options: {
      stage,
      target: LAKE_STAGES[stage],
      destination: resolved,
      staging: `${resolved}.pulling`,
    },
  };
}

/** Read the published build id from the pod. */
export function currentBuildCommand(
  target: LakeStageTarget,
): readonly string[] {
  return ["cat", path.posix.join(target.lakeDir, "CURRENT")];
}

/** List the tables inside a published build, one per line. */
export function buildTableListCommand(
  target: LakeStageTarget,
  buildId: string,
): readonly string[] {
  return ["ls", path.posix.join(target.lakeDir, "builds", buildId)];
}

/**
 * Stream ONE entry of a build out as a tar, from inside the build directory.
 *
 * Deliberately per-entry rather than one archive for the whole build. A prod
 * build is ~900 MB and a single `kubectl exec` pipe of that size truncates —
 * observed, mid-`prematch`, after ~770 MB. Splitting it means each transfer is
 * small enough to survive, a truncation costs one table instead of everything,
 * and each can be retried on its own.
 *
 * `-C` roots the archive at the entry name, so it unpacks into the staged
 * build directory with no path prefix to strip. The `-recent` staging
 * directories are never named, which is how "a replay reads a frozen dataset"
 * stays enforced rather than documented.
 */
export function buildEntryTarCommand(
  target: LakeStageTarget,
  buildId: string,
  entry: string,
): readonly string[] {
  return [
    "tar",
    "-cf",
    "-",
    "-C",
    path.posix.join(target.lakeDir, "builds", buildId),
    entry,
  ];
}

/** Count the files a build entry holds on the pod, to verify the copy. */
export function buildEntryFileCountCommand(
  target: LakeStageTarget,
  buildId: string,
  entry: string,
): readonly string[] {
  return [
    "sh",
    "-c",
    `find ${path.posix.join(target.lakeDir, "builds", buildId, entry)} -type f | wc -l`,
  ];
}
