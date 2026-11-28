import policy from "../../../packages/version-catalog/src/image-registry.json" with { type: "json" };
import { dockerHubCredentials } from "../../../scripts/lib/dockerhub-credentials.ts";
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

const dockerHub = "https://hub.docker.com";

async function hubJson(
  path: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetcher(new URL(path, dockerHub), {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new TransientError("Docker Hub repository preflight request failed");
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const message = `Docker Hub repository preflight returned HTTP ${String(response.status)}`;
    if (
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      throw new TransientError(message);
    }
    throw new AccessPolicyError(message);
  }
  try {
    const result = asRecord(await response.json());
    if (result !== null) return result;
  } catch {
    // Transport/JSON errors must never include a credential-bearing body.
  }
  throw new TransientError(
    "Docker Hub repository preflight returned invalid JSON",
  );
}

/** Docker Hub may implicitly create a public repository for the first push. */
export async function ensurePrivateDockerHubRepositories(
  names: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const privateNames = names.filter((name) =>
    policy.images.some(
      (image) => image.name === name && image.visibility === "private",
    ),
  );
  if (privateNames.length === 0) return;

  const { username, password } = dockerHubCredentials("publisher", environment);
  const login = await hubJson(
    "/v2/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: username, secret: password }),
    },
    fetcher,
  );
  const token = login?.["access_token"];
  if (typeof token !== "string" || token.length === 0) {
    throw new TransientError(
      "Docker Hub repository preflight received no access token",
    );
  }

  for (const name of privateNames) {
    const repository = `${policy.namespace}/${name}`;
    const metadata = await hubJson(
      `/v2/namespaces/${policy.namespace}/repositories/${name}`,
      { headers: { Authorization: `Bearer ${token}` } },
      fetcher,
    );
    if (
      metadata?.["namespace"] !== policy.namespace ||
      metadata["name"] !== name ||
      metadata["is_private"] !== true
    ) {
      throw new AccessPolicyError(
        `Docker Hub repository ${repository} is not confirmed private; wait for tofu-dockerhub/prod before pushing`,
      );
    }
  }
}

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
