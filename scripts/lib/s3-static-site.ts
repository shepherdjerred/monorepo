/**
 * Two-pass `aws s3 sync` for static sites on SeaweedFS (ported from the old
 * CI's `s3SyncStaticSite`; extracted from scripts/deploy-site.ts so the scout
 * lockstep deploy scripts share the exact same sync semantics).
 */

import { run, runAllowExit } from "./run.ts";

export const SEAWEEDFS_ENDPOINT = "https://seaweedfs-s3.tailnet-1a49.ts.net";

/**
 * Env vars every SeaweedFS-bound aws CLI call needs: SeaweedFS S3 requires
 * s3v4 signing, so the region is pinned to avoid mismatches with newer AWS CLI
 * versions that use CRT-based signing, and the WHEN_REQUIRED settings suppress
 * checksum headers AWS CLI v2 sends by default but SeaweedFS does not
 * understand.
 */
export const SEAWEEDFS_AWS_ENV: Record<string, string> = {
  AWS_DEFAULT_REGION: "us-east-1",
  AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
  AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
};

/** Refuse to sync a partial static site that would delete a live entrypoint. */
export async function assertStaticSiteComplete(
  dir: string,
  label: string,
): Promise<void> {
  for (const path of ["index.html", "app/index.html"]) {
    if (!(await Bun.file(`${dir}/${path}`).exists())) {
      throw new Error(`${label}: ${dir}/${path} is missing — refusing to sync`);
    }
  }
}

/** AWS CLI's stable missing-key diagnostics for `s3 cp` object reads. */
export function isMissingS3Object(stderr: string): boolean {
  return (
    stderr.includes("NoSuchKey") ||
    stderr.includes("HeadObject operation: Not Found") ||
    (stderr.includes("404") && stderr.includes("does not exist"))
  );
}

/**
 * Build the forced mutable-file copy used for release archives materialized
 * locally from S3. Unlike `aws s3 sync`, `cp --recursive` overwrites matching
 * destination keys even when archive timestamps make the sync comparator think
 * a changed entrypoint is current.
 */
export function forceMutableUploadCommand(opts: {
  source: string;
  dest: string;
  endpoint: string;
  excludes: string[];
  dryRun: boolean;
}): string[] {
  return [
    "aws",
    "s3",
    "cp",
    opts.source,
    opts.dest,
    "--recursive",
    "--endpoint-url",
    opts.endpoint,
    ...opts.excludes.flatMap((pattern) => ["--exclude", pattern]),
    "--cache-control",
    "no-cache",
    ...(opts.dryRun ? ["--dryrun"] : []),
  ];
}

/**
 * Read stage-bucket objects back and require them to be byte-identical to the
 * source release. Deployment markers must not advance when an S3 comparator
 * skipped a changed mutable entrypoint.
 */
export async function firstS3ObjectMismatch(opts: {
  sourceDir: string;
  bucket: string;
  paths: readonly string[];
  scratchDir: string;
  endpoint: string;
  env: Record<string, string>;
}): Promise<string | undefined> {
  for (const path of opts.paths) {
    const expectedPath = `${opts.sourceDir}/${path}`;
    const servedPath = `${opts.scratchDir}/served/${path}`;
    const parentDir = servedPath.slice(0, servedPath.lastIndexOf("/"));
    await Bun.$`mkdir -p ${parentDir}`.quiet();
    const download = await runAllowExit(
      [
        "aws",
        "s3",
        "cp",
        `s3://${opts.bucket}/${path}`,
        servedPath,
        "--endpoint-url",
        opts.endpoint,
      ],
      { env: opts.env, capture: true },
    );
    if (download.exitCode !== 0) {
      if (isMissingS3Object(download.stderr)) {
        return path;
      }
      throw new Error(
        `could not read s3://${opts.bucket}/${path} for release verification (exit ${download.exitCode.toString()}): ${download.stderr.trim()}`,
      );
    }
    const [expected, served] = await Promise.all([
      Bun.file(expectedPath).text(),
      Bun.file(servedPath).text(),
    ]);
    if (expected !== served) {
      return path;
    }
  }
  return undefined;
}

export async function assertS3ObjectsMatchSource(opts: {
  sourceDir: string;
  bucket: string;
  paths: readonly string[];
  scratchDir: string;
  endpoint: string;
  env: Record<string, string>;
}): Promise<void> {
  const mismatchedPath = await firstS3ObjectMismatch(opts);
  if (mismatchedPath !== undefined) {
    throw new Error(
      `s3://${opts.bucket}/${mismatchedPath} differs from the selected source release`,
    );
  }
}

/**
 * Sync `source` to `s3://bucket/`, setting `Cache-Control` as S3 object
 * metadata (caddy-s3-proxy passes it through to the browser/CDN unchanged).
 *
 * Pass 1 uploads content-hashed/fingerprinted assets — the `immutablePrefixes`
 * (e.g. `_astro/`, `app/assets/`) — with a 1-year `immutable` Cache-Control and
 * WITHOUT `--delete`, so prior builds' hashed files survive for already-loaded
 * tabs. Pass 2 uploads everything else with `Cache-Control: no-cache` and
 * `--delete`, `--exclude`ing the hashed prefixes so retained old hashed assets
 * are left in place. When `immutablePrefixes` is empty a single `no-cache` +
 * `--delete` pass is used.
 *
 * `extraExcludes` are appended to the deleting pass's `--exclude`s: bucket
 * objects the deploy does not own and must never prune (e.g. the scout
 * `.release-version` marker, which is written separately after a successful
 * sync).
 *
 * `forceMutableUpload` is for deployments materialized from an S3 archive.
 * The archive download preserves object timestamps, so `aws s3 sync` can
 * incorrectly retain a changed mutable entrypoint when its size and timestamp
 * compare equal to the destination. When enabled, a recursive `aws s3 cp`
 * uploads every non-immutable object before the normal deleting sync.
 */
export async function s3SyncStaticSite(opts: {
  source: string;
  bucket: string;
  endpoint: string;
  immutablePrefixes: string[];
  extraExcludes?: string[];
  forceMutableUpload?: boolean;
  cwd: string;
  env: Record<string, string>;
  dryRun: boolean;
  haveCreds: boolean;
}): Promise<void> {
  const {
    source,
    bucket,
    endpoint,
    immutablePrefixes,
    cwd,
    env,
    forceMutableUpload = false,
  } = opts;
  const extraExcludes = opts.extraExcludes ?? [];
  const dest = `s3://${bucket}/`;
  const deletePassExcludes = [
    ...immutablePrefixes.map((p) => `${p}*`),
    ...extraExcludes,
  ];

  if (opts.dryRun) {
    const plan =
      immutablePrefixes.length > 0
        ? `pass 1 [${immutablePrefixes.join(", ")}] immutable (no --delete); ` +
          `${forceMutableUpload ? "force-copy " : "sync "}everything else no-cache ` +
          `(--delete, excluding immutable prefixes)`
        : `${forceMutableUpload ? "force-copy " : "sync "}everything no-cache (--delete)`;
    console.log(
      `DRYRUN: would sync ${source} -> ${dest} via ${endpoint} — ${plan}`,
    );
    if (!opts.haveCreds) {
      console.log(
        "DRYRUN: AWS credentials absent; skipping the real `aws s3 sync --dryrun` call. " +
          "The plan above is what would run with creds present.",
      );
      return;
    }
    // Creds present — surface exactly what the sync would move via --dryrun.
    if (immutablePrefixes.length > 0) {
      await run(
        [
          "aws",
          "s3",
          "sync",
          source,
          dest,
          "--endpoint-url",
          endpoint,
          "--exclude",
          "*",
          ...immutablePrefixes.flatMap((p) => ["--include", `${p}*`]),
          "--cache-control",
          "public, max-age=31536000, immutable",
          "--dryrun",
        ],
        { cwd, env },
      );
    }
    if (forceMutableUpload) {
      await run(
        forceMutableUploadCommand({
          source,
          dest,
          endpoint,
          excludes: deletePassExcludes,
          dryRun: true,
        }),
        { cwd, env },
      );
    }
    await run(
      [
        "aws",
        "s3",
        "sync",
        source,
        dest,
        "--endpoint-url",
        endpoint,
        ...deletePassExcludes.flatMap((p) => ["--exclude", p]),
        "--cache-control",
        "no-cache",
        "--delete",
        "--dryrun",
      ],
      { cwd, env },
    );
    return;
  }

  // Pass 1: immutable, fingerprinted assets — no --delete.
  if (immutablePrefixes.length > 0) {
    await run(
      [
        "aws",
        "s3",
        "sync",
        source,
        dest,
        "--endpoint-url",
        endpoint,
        "--exclude",
        "*",
        ...immutablePrefixes.flatMap((p) => ["--include", `${p}*`]),
        "--cache-control",
        "public, max-age=31536000, immutable",
      ],
      { cwd, env },
    );
  }

  if (forceMutableUpload) {
    await run(
      forceMutableUploadCommand({
        source,
        dest,
        endpoint,
        excludes: deletePassExcludes,
        dryRun: false,
      }),
      { cwd, env },
    );
  }

  // Pass 2 (or single pass): everything else, no-cache + --delete, excluding
  // the immutable prefixes so `--delete` never prunes retained hashed assets.
  await run(
    [
      "aws",
      "s3",
      "sync",
      source,
      dest,
      "--endpoint-url",
      endpoint,
      ...deletePassExcludes.flatMap((p) => ["--exclude", p]),
      "--cache-control",
      "no-cache",
      "--delete",
    ],
    { cwd, env },
  );
}
