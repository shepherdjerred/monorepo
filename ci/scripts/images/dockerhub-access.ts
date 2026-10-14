import policy from "../../../packages/version-catalog/src/image-registry.json" with { type: "json" };
import { asRecord } from "../../../scripts/lib/json.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

export type RegistryAccessVerifier = (
  name: string,
  digest: string,
) => Promise<void>;
type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;
const accept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

class AccessPolicyError extends Error {}

function visibilityFailure(name: string, publicImage: boolean): Error {
  return new AccessPolicyError(
    publicImage
      ? `Public Docker Hub image ${name} is not anonymously pullable`
      : `Private Docker Hub image ${name} is anonymously pullable`,
  );
}

function failure(status: number): Error {
  const message = `Docker Hub anonymous access probe returned HTTP ${status.toString()}`;
  return status === 408 || status === 429 || status === 404 || status >= 500
    ? new TransientError(message)
    : new AccessPolicyError(message);
}

async function anonymouslyReadable(
  tokenUrl: URL,
  manifestUrl: string,
  fetcher: Fetcher,
): Promise<boolean> {
  const tokenResponse = await fetcher(tokenUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (tokenResponse.status === 401) return false;
  if (!tokenResponse.ok) throw failure(tokenResponse.status);
  const body: unknown = await tokenResponse.json();
  const token = asRecord(body)?.["token"];
  if (typeof token !== "string" || token.length === 0)
    throw new TransientError("Docker Hub anonymous token is missing");
  const manifest = await fetcher(manifestUrl, {
    headers: { Accept: accept, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (manifest.status === 401) return false;
  if (!manifest.ok) throw failure(manifest.status);
  await manifest.arrayBuffer();
  return true;
}

/** Call after an authenticated digest lookup proves the pushed image exists. */
export async function ensureDockerHubAccess(
  name: string,
  digest: string,
  options: {
    readonly fetcher?: Fetcher;
    readonly sleeper?: (milliseconds: number) => Promise<unknown>;
    readonly attempts?: number;
  } = {},
): Promise<void> {
  const registration = policy.images.find((image) => image.name === name);
  if (registration === undefined)
    throw new Error(`Unregistered image: ${name}`);
  if (!/^sha256:[a-f\d]{64}$/u.test(digest))
    throw new Error("Invalid image digest");
  const fetcher = options.fetcher ?? fetch;
  const sleeper = options.sleeper ?? Bun.sleep;
  const attempts = options.attempts ?? 6;
  const tokenUrl = new URL("https://auth.docker.io/token");
  tokenUrl.searchParams.set("service", "registry.docker.io");
  tokenUrl.searchParams.set(
    "scope",
    `repository:${policy.namespace}/${name}:pull`,
  );
  const manifestUrl = `https://registry-1.docker.io/v2/${policy.namespace}/${name}/manifests/${digest}`;
  let lastFailure: Error = new Error("Docker Hub access probe did not run");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const readable = await anonymouslyReadable(
        tokenUrl,
        manifestUrl,
        fetcher,
      );
      if (readable === (registration.visibility === "public")) return;
      throw visibilityFailure(name, registration.visibility === "public");
    } catch (error) {
      // Registry token/body diagnostics may contain credentials; retain status only.
      lastFailure =
        error instanceof TransientError || error instanceof AccessPolicyError
          ? error
          : new TransientError("Docker Hub anonymous access probe failed");
    }
    if (!(lastFailure instanceof TransientError)) break;
    if (attempt < attempts) await sleeper(2000);
  }
  throw lastFailure;
}
