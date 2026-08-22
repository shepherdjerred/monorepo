import { asRecord } from "../../scripts/lib/json.ts";
import { requiresPublicGhcrVisibility } from "./image-targets.ts";
import { TransientError } from "../../scripts/lib/transient-error.ts";

const manifestAccept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * Only the call signature is used, so injected doubles do not have to carry
 * Bun's extra `fetch` statics (`preconnect`) to satisfy the type.
 */
export type GhcrFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type AnonymousPullOptions = {
  readonly fetcher?: GhcrFetcher;
  readonly sleeper?: (milliseconds: number) => Promise<unknown>;
  readonly attempts?: number;
  readonly delayMilliseconds?: number;
};

export type AnonymousPullVerifier = (
  name: string,
  reference: string,
) => Promise<void>;

export function anonymousPullVerifier(
  dependency: AnonymousPullVerifier | undefined,
): AnonymousPullVerifier {
  return dependency ?? ensureAnonymousGhcrPull;
}

type GhcrEndpoint = "token" | "manifest";

function responseFailure(endpoint: GhcrEndpoint, status: number): Error {
  const message = `${endpoint} endpoint returned HTTP ${status.toString()}`;
  return status === 408 ||
    status === 429 ||
    status >= 500 ||
    (endpoint === "manifest" && status === 404)
    ? new TransientError(message)
    : new Error(message);
}

async function ghcrRequest(
  fetcher: GhcrFetcher,
  input: string | URL,
  init: RequestInit,
  endpoint: GhcrEndpoint,
): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch (error) {
    throw new TransientError(`${endpoint} request failed`, { cause: error });
  }
}

async function anonymousToken(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new TransientError("GHCR anonymous token response body failed", {
      cause: error,
    });
  }
  const token = asRecord(body)?.["token"];
  if (typeof token !== "string" || token.length === 0) {
    throw new TransientError("GHCR anonymous token response omitted token");
  }
  return token;
}

async function consumeManifest(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch (error) {
    throw new TransientError("GHCR anonymous manifest response body failed", {
      cause: error,
    });
  }
}

/**
 * GitHub exposes NO API for changing package visibility — the Packages REST
 * API offers only get/list/delete/restore, and the web UI gates the change
 * behind a typed confirmation. A newly published package is therefore private
 * until a human flips it once, so this probe is the enforcement point and the
 * message has to carry the manual step rather than pretend CI can repair it.
 */
function remediation(name: string): string {
  // Every probed name is a first-party package under ghcr.io/shepherdjerred —
  // the infra bake targets (caddy-s3proxy, obsidian-headless, redlib) as much
  // as the IMAGE_TARGET_REGISTRY applications — so the one-time manual flip
  // applies to all of them; only the framing differs.
  const declaration = requiresPublicGhcrVisibility(name)
    ? `${name} is declared public in IMAGE_TARGET_REGISTRY`
    : `${name} is a first-party infra image pushed under ghcr.io/shepherdjerred`;
  return ` ${declaration}: open https://github.com/users/shepherdjerred/packages/container/${encodeURIComponent(name)}/settings and set "Change visibility" to Public (one time, per package).`;
}

export async function ensureAnonymousGhcrPull(
  name: string,
  reference: string,
  options: AnonymousPullOptions = {},
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const sleeper = options.sleeper ?? Bun.sleep;
  const attempts = options.attempts ?? 6;
  const delayMilliseconds = options.delayMilliseconds ?? 2000;
  const tokenUrl = new URL("https://ghcr.io/token");
  tokenUrl.searchParams.set("scope", `repository:shepherdjerred/${name}:pull`);
  tokenUrl.searchParams.set("service", "ghcr.io");
  const manifestUrl = `https://ghcr.io/v2/shepherdjerred/${encodeURIComponent(name)}/manifests/${encodeURIComponent(reference)}`;
  let failure: Error = new Error("anonymous pull probe did not run");

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const tokenResponse = await ghcrRequest(
        fetcher,
        tokenUrl,
        { signal: AbortSignal.timeout(20_000) },
        "token",
      );
      if (!tokenResponse.ok) {
        throw responseFailure("token", tokenResponse.status);
      }
      const token = await anonymousToken(tokenResponse);
      const manifestResponse = await ghcrRequest(
        fetcher,
        manifestUrl,
        {
          headers: {
            Accept: manifestAccept,
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(20_000),
        },
        "manifest",
      );
      if (!manifestResponse.ok) {
        throw responseFailure("manifest", manifestResponse.status);
      }
      await consumeManifest(manifestResponse);
      return;
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new TransientError("GHCR anonymous pull probe failed", {
              cause: error,
            });
    }

    if (attempt < attempts) {
      console.log(
        `waiting for anonymous GHCR pull access: ${name}:${reference} (${attempt.toString()}/${attempts.toString()}): ${failure.message}`,
      );
      await sleeper(delayMilliseconds);
    }
  }

  const message = `GHCR package shepherdjerred/${name} is not anonymously pullable at ${reference}: ${failure.message}. Application images must be public and carry the monorepo OCI source label.${remediation(name)}`;
  if (failure instanceof TransientError) {
    throw new TransientError(message, { cause: failure });
  }
  throw new Error(message, { cause: failure });
}
