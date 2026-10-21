import { createHash } from "node:crypto";
import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";

export type RegistryTransport = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;
export type RegistryLocation = {
  /** Registry API origin; Docker Hub's catalog host does not serve `/v2/`. */
  origin: string;
  /** Repository path on the registry API. */
  repository: string;
  /** Artifact URI as the catalog names the image: `<registry host>/<name>`. */
  uri: string;
};

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_TOKEN_BYTES = 64 * 1024;
const TIMEOUT_MS = 30_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DOCKER_HUB_HOSTS = new Set([
  "docker.io",
  "index.docker.io",
  "registry-1.docker.io",
]);
const BearerChallengeSchema = z.object({
  realm: z.url(),
  service: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
});
const RegistryTokenSchema = z.object({
  token: z.string().min(1).optional(),
  access_token: z.string().min(1).optional(),
});

/** Where a catalog image entry lives, from its `registryUrl` and name. */
export function registryLocation(
  registryUrl: string,
  name: string,
): RegistryLocation {
  const url = new URL(registryUrl);
  if (url.protocol !== "https:")
    throw new Error(`Image registry ${registryUrl} must be https`);
  const prefix = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const path = prefix === "" ? name : `${prefix}/${name}`;
  const dockerHub = DOCKER_HUB_HOSTS.has(url.host);
  return {
    origin: dockerHub ? "https://registry-1.docker.io" : url.origin,
    // Docker Hub serves official images under the implicit `library` namespace.
    repository: dockerHub && !path.includes("/") ? `library/${path}` : path,
    uri: `${url.host}/${path}`,
  };
}

/** Collect a response body up to `limit` bytes; a larger body is refused, never truncated. */
export async function boundedBody(
  response: Response,
  limit: number,
  label: string,
): Promise<Uint8Array> {
  if (response.body === null)
    throw new DeliveryError("PAUSED", `${label} returned no body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit)
        throw new DeliveryError(
          "INVALID",
          `${label} exceeds the verification size limit`,
        );
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

function bearerChallenge(header: string | null) {
  const values: Record<string, string> = {};
  if (header?.toLowerCase().startsWith("bearer ") === true)
    for (const match of header.matchAll(/(\w+)="([^"]*)"/g)) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) values[key] = value;
    }
  const parsed = BearerChallengeSchema.safeParse(values);
  return parsed.success ? parsed.data : undefined;
}

async function manifestRequest(
  url: string,
  transport: RegistryTransport,
  authorization?: string,
) {
  const response = await transport(url, {
    headers: {
      Accept: MANIFEST_ACCEPT,
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (REDIRECTS.has(response.status)) {
    await response.body?.cancel();
    throw new DeliveryError(
      "INVALID",
      "Registry manifest redirected; manifests are read from the catalog registry only",
    );
  }
  return response;
}

/** Anonymous pull token from the registry's bearer challenge; the token is never logged or stored. */
async function anonymousToken(
  challenge: z.infer<typeof BearerChallengeSchema>,
  repository: string,
  transport: RegistryTransport,
) {
  const tokenUrl = new URL(challenge.realm);
  if (tokenUrl.protocol !== "https:")
    throw new DeliveryError(
      "INVALID",
      "Registry token realm must be an https endpoint",
    );
  if (challenge.service !== undefined)
    tokenUrl.searchParams.set("service", challenge.service);
  tokenUrl.searchParams.set(
    "scope",
    challenge.scope ?? `repository:${repository}:pull`,
  );
  const response = await transport(tokenUrl, {
    headers: { Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new DeliveryError(
      "PAUSED",
      `Registry token service unavailable (${String(response.status)})`,
    );
  }
  const text = new TextDecoder().decode(
    await boundedBody(response, MAX_TOKEN_BYTES, "Registry token"),
  );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const payload = RegistryTokenSchema.safeParse(raw);
  const token = payload.success
    ? (payload.data.token ?? payload.data.access_token)
    : undefined;
  if (token === undefined)
    throw new DeliveryError(
      "PAUSED",
      "Registry token service returned no anonymous pull token",
    );
  return token;
}

/**
 * Resolve a tag to its manifest digest through the registry API: sha256 of
 * the manifest bytes as served, cross-checked against `Docker-Content-Digest`
 * when the registry sends it. Reads the manifest only, never image layers.
 */
export async function resolveManifestDigest(
  location: Pick<RegistryLocation, "origin" | "repository">,
  reference: string,
  transport: RegistryTransport,
): Promise<string> {
  const url = `${location.origin}/v2/${location.repository}/manifests/${encodeURIComponent(reference)}`;
  let response = await manifestRequest(url, transport);
  if (response.status === 401) {
    const challenge = bearerChallenge(response.headers.get("www-authenticate"));
    await response.body?.cancel();
    if (challenge === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Registry refused anonymous manifest access without a bearer challenge",
      );
    const token = await anonymousToken(
      challenge,
      location.repository,
      transport,
    );
    response = await manifestRequest(url, transport, `Bearer ${token}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DeliveryError(
      "PAUSED",
      `Registry manifest resolution unavailable (${String(response.status)})`,
    );
  }
  const bytes = await boundedBody(
    response,
    MAX_MANIFEST_BYTES,
    "Registry manifest",
  );
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const declared = response.headers.get("docker-content-digest");
  if (declared !== null && declared !== digest)
    throw new DeliveryError(
      "INVALID",
      "Registry content digest disagrees with the served manifest bytes",
    );
  return digest;
}
