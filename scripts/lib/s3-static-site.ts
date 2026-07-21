/**
 * Two-pass `aws s3 sync` for static sites on SeaweedFS (ported from the old
 * CI's `s3SyncStaticSite`; extracted from scripts/deploy-site.ts so the scout
 * lockstep deploy scripts share the exact same sync semantics).
 */

import { run } from "./run.ts";

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
 */
export async function s3SyncStaticSite(opts: {
  source: string;
  bucket: string;
  endpoint: string;
  immutablePrefixes: string[];
  extraExcludes?: string[];
  cwd: string;
  env: Record<string, string>;
  dryRun: boolean;
  haveCreds: boolean;
}): Promise<void> {
  const { source, bucket, endpoint, immutablePrefixes, cwd, env } = opts;
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
          `pass 2 everything else no-cache (--delete, excluding immutable prefixes)`
        : `single pass no-cache (--delete)`;
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
