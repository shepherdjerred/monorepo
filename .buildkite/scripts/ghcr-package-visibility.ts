import { requiresPublicGhcrVisibility } from "./image-targets.ts";

export type GhcrPackageVisibilityFetcher = (
  input: string | URL,
  init: RequestInit,
) => Promise<Response>;

function githubPackageUrl(packageName: string): URL {
  return new URL(
    `/user/packages/container/${encodeURIComponent(packageName)}`,
    "https://api.github.com",
  );
}

/**
 * Public visibility is declared only for first-party application targets. The
 * Packages API mutation deliberately precedes the anonymous manifest probe:
 * that probe remains an independent check of the effect rather than being the
 * mechanism that tries to repair it.
 */
export async function ensureDeclaredGhcrPackageVisibility(
  packageName: string,
  token: string | undefined,
  fetcher: GhcrPackageVisibilityFetcher = fetch,
): Promise<void> {
  if (!requiresPublicGhcrVisibility(packageName)) return;
  if (token === undefined || token.length === 0) {
    throw new Error(
      `GH_TOKEN is required to make first-party GHCR package ${packageName} public`,
    );
  }
  let response: Response;
  try {
    response = await fetcher(githubPackageUrl(packageName), {
      method: "PATCH",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ visibility: "public" }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`GHCR visibility update failed for ${packageName}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(
      `GitHub Packages API could not make GHCR package ${packageName} public: HTTP ${response.status.toString()} ${response.statusText}. Grant GH_TOKEN package administration permission.`,
    );
  }
}
