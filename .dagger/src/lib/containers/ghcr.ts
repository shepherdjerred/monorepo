import type { Container, Secret } from "@dagger.io/dagger";

export type GhcrPublishOptions = {
  /** The container to publish */
  container: Container;
  /** Full image reference (e.g., "ghcr.io/owner/repo:tag") */
  imageRef: string;
  /** GHCR username */
  username: string;
  /** GHCR password/token as a secret */
  password: Secret;
};

export type GhcrPublishMultipleOptions = {
  /** The container to publish */
  container: Container;
  /** Image references to publish (e.g., ["ghcr.io/owner/repo:1.0.0", "ghcr.io/owner/repo:latest"]) */
  imageRefs: string[];
  /** GHCR username */
  username: string;
  /** GHCR password/token as a secret */
  password: Secret;
};

/**
 * Publishes a container image to GitHub Container Registry (GHCR).
 *
 * @param options - Publish configuration options
 * @returns The published image reference
 *
 * @example
 * ```ts
 * const ref = await publishToGhcr({
 *   container: builtImage,
 *   imageRef: "ghcr.io/owner/repo:1.0.0",
 *   username: "owner",
 *   password: dag.setSecret("ghcr-token", process.env.GHCR_TOKEN),
 * });
 * ```
 */
export async function publishToGhcr(
  options: GhcrPublishOptions,
): Promise<string> {
  return await options.container
    .withRegistryAuth("ghcr.io", options.username, options.password)
    .publish(options.imageRef);
}

/**
 * Publishes a container image to multiple GHCR tags in parallel.
 * Useful for publishing both versioned and "latest" tags.
 *
 * @param options - Publish configuration options
 * @returns Array of published image references
 *
 * @example
 * ```ts
 * const refs = await publishToGhcrMultiple({
 *   container: builtImage,
 *   imageRefs: [
 *     "ghcr.io/owner/repo:1.0.0",
 *     "ghcr.io/owner/repo:latest",
 *   ],
 *   username: "owner",
 *   password: dag.setSecret("ghcr-token", process.env.GHCR_TOKEN),
 * });
 * ```
 */
export async function publishToGhcrMultiple(
  options: GhcrPublishMultipleOptions,
): Promise<string[]> {
  const authenticatedContainer = options.container.withRegistryAuth(
    "ghcr.io",
    options.username,
    options.password,
  );

  const publishPromises = options.imageRefs.map((ref) =>
    authenticatedContainer.publish(ref),
  );

  return await Promise.all(publishPromises);
}

/**
 * Creates a container authenticated with GHCR but doesn't publish.
 * Useful when you need to compose additional operations before publishing.
 *
 * @param container - The container to authenticate
 * @param username - GHCR username
 * @param password - GHCR password/token as a secret
 * @returns The authenticated container
 */
export function withGhcrAuth(
  container: Container,
  username: string,
  password: Secret,
): Container {
  return container.withRegistryAuth("ghcr.io", username, password);
}
