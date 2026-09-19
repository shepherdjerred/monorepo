/**
 * Resolve the CI toolchain images for a specific commit.
 *
 * The digests are committed to the repository and rotated by the image lane's
 * commit-back, so they differ per commit. The extension therefore reads them
 * from the repository at the pipeline's own commit rather than baking them
 * into its own image — a baked value would pin every build to whatever was
 * current when the extension was last deployed, silently running the wrong
 * toolchain after a rotation.
 *
 * The repository is public, so this needs no credentials.
 */

import type { FetchLike } from "#src/http.ts";

const DIGEST_PATHS = {
  base: ".buildkite/ci-image/DIGEST",
  playwright: ".buildkite/ci-playwright/DIGEST",
} as const;

const IMAGE_REPOS = {
  base: "ghcr.io/shepherdjerred/ci-base",
  playwright: "ghcr.io/shepherdjerred/ci-playwright",
} as const;

const DIGEST_PATTERN = /^sha256:[\da-f]{64}$/u;

export type CiImages = {
  readonly base: string;
  readonly playwright: string;
};

export type ImageFetcher = (path: string, commit: string) => Promise<string>;

function rawUrl(repoSlug: string, commit: string, path: string): string {
  return `https://raw.githubusercontent.com/${repoSlug}/${commit}/${path}`;
}

export function createRawFetcher(
  repoSlug: string,
  fetchImpl: FetchLike = fetch,
): ImageFetcher {
  return async (path, commit) => {
    const response = await fetchImpl(rawUrl(repoSlug, commit, path));
    if (!response.ok) {
      throw new Error(
        `could not read ${path} at ${commit} (${response.status.toString()})`,
      );
    }
    const text = await response.text();
    return text.trim();
  };
}

/**
 * Reject anything that is not an exact digest.
 *
 * A malformed value would otherwise be interpolated straight into an image
 * reference, turning a typo into a step that pulls an unexpected tag.
 */
function requireDigest(value: string, path: string): string {
  if (!DIGEST_PATTERN.test(value)) {
    throw new Error(`invalid CI image digest in ${path}: ${value}`);
  }
  return value;
}

export async function resolveCiImages(
  commit: string,
  fetcher: ImageFetcher,
): Promise<CiImages> {
  const [base, playwright] = await Promise.all([
    fetcher(DIGEST_PATHS.base, commit),
    fetcher(DIGEST_PATHS.playwright, commit),
  ]);
  return {
    base: `${IMAGE_REPOS.base}@${requireDigest(base, DIGEST_PATHS.base)}`,
    playwright: `${IMAGE_REPOS.playwright}@${requireDigest(playwright, DIGEST_PATHS.playwright)}`,
  };
}
