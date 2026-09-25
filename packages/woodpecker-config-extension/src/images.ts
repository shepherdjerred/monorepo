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

import { z } from "zod";

import type { FetchLike } from "#src/http.ts";

const CATALOG_PATH = "packages/version-catalog/src/catalog.json";

/**
 * Third-party images individual lanes run in.
 *
 * Read from the version catalog rather than pinned here so Renovate stays the
 * single owner of the version, and read at the pipeline's own commit for the
 * same reason the toolchain digests are: a value baked into this service would
 * outlive the commit that changed it.
 *
 * Catalog values already carry their tag and digest, so the reference is the
 * repository name joined to the value with a colon.
 */
export type CatalogImageName =
  | "aquasec/trivy"
  | "semgrep/semgrep"
  | "texlive/texlive"
  | "trmnl/trmnlp"
  | "grafana/tempo"
  | "mikefarah/yq"
  | "minio/mc"
  | "minio/minio";

const DIGEST_PATHS = {
  base: "ci/ci-image/DIGEST",
  playwright: "ci/ci-playwright/DIGEST",
  windowsCrossCompilerWinui:
    "packages/windows-cross-compiler/images/windows-cross-compiler-winui/DIGEST",
} as const;

const IMAGE_REPOS = {
  base: "ghcr.io/shepherdjerred/ci-base",
  playwright: "ghcr.io/shepherdjerred/ci-playwright",
  windowsCrossCompilerWinui:
    "ghcr.io/shepherdjerred/windows-cross-compiler-winui",
} as const;

const DIGEST_PATTERN = /^sha256:[\da-f]{64}$/u;

export type CiImages = {
  /** Digest-pinned toolchain image, shared with developer machines. */
  readonly base: string;
  /** Digest-pinned browser toolchain image. */
  readonly playwright: string;
  /**
   * Digest-pinned WinUI cross-compiler, which builds the TaskNotes Windows
   * app and its MSIX on Linux. Promoted by its own refresh lane.
   */
  readonly windowsCrossCompilerWinui: string;
  /** Third-party images, keyed by their version-catalog name. */
  readonly catalog: Readonly<Record<CatalogImageName, string>>;
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

/**
 * The slice of the version catalog this service reads.
 *
 * Loose so an added field does not break CI, but `name` and `value` are
 * required: a malformed entry must fail rather than be skipped, since a
 * skipped entry reads as "no such image" and would take a lane down with a
 * confusing error.
 */
const CatalogSchema = z.looseObject({
  entries: z.array(z.looseObject({ name: z.string(), value: z.string() })),
});

/**
 * Look one image up in the catalog.
 *
 * Throws on a missing entry rather than falling back to a default tag: a lane
 * silently running an unpinned `latest` scanner is exactly the drift the
 * catalog exists to prevent.
 */
function catalogVersion(catalog: string, name: string): string {
  const parsed = CatalogSchema.safeParse(JSON.parse(catalog));
  if (!parsed.success) {
    throw new TypeError("version catalog has an unexpected shape");
  }
  const entry = parsed.data.entries.find(
    (candidate) => candidate.name === name,
  );
  if (entry === undefined || entry.value.length === 0) {
    throw new Error(`version catalog has no entry named ${name}`);
  }
  return entry.value;
}

/** Full image reference for one catalogued name. */
function reference(catalog: string, name: CatalogImageName): string {
  return `${name}:${catalogVersion(catalog, name)}`;
}

export async function resolveCiImages(
  commit: string,
  fetcher: ImageFetcher,
): Promise<CiImages> {
  const [base, playwright, windowsCrossCompilerWinui, catalog] =
    await Promise.all([
      fetcher(DIGEST_PATHS.base, commit),
      fetcher(DIGEST_PATHS.playwright, commit),
      fetcher(DIGEST_PATHS.windowsCrossCompilerWinui, commit),
      fetcher(CATALOG_PATH, commit),
    ]);
  return {
    base: `${IMAGE_REPOS.base}@${requireDigest(base, DIGEST_PATHS.base)}`,
    playwright: `${IMAGE_REPOS.playwright}@${requireDigest(playwright, DIGEST_PATHS.playwright)}`,
    windowsCrossCompilerWinui: `${IMAGE_REPOS.windowsCrossCompilerWinui}@${requireDigest(windowsCrossCompilerWinui, DIGEST_PATHS.windowsCrossCompilerWinui)}`,
    catalog: {
      "aquasec/trivy": reference(catalog, "aquasec/trivy"),
      "semgrep/semgrep": reference(catalog, "semgrep/semgrep"),
      "texlive/texlive": reference(catalog, "texlive/texlive"),
      "trmnl/trmnlp": reference(catalog, "trmnl/trmnlp"),
      "grafana/tempo": reference(catalog, "grafana/tempo"),
      "mikefarah/yq": reference(catalog, "mikefarah/yq"),
      "minio/mc": reference(catalog, "minio/mc"),
      "minio/minio": reference(catalog, "minio/minio"),
    },
  };
}
