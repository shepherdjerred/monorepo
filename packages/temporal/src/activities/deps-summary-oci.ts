import { z } from "zod/v4";
import type { DependencyChange } from "./deps-summary.ts";
import { dependencyNoteText } from "./deps-summary-text.ts";

const OciDescriptorSchema = z.object({ digest: z.string().min(1) });
const OciManifestSchema = z.object({
  annotations: z.record(z.string(), z.string()).optional(),
  config: OciDescriptorSchema.optional(),
  manifests: z.array(OciDescriptorSchema).optional(),
});
const OciConfigSchema = z.object({
  config: z
    .object({ Labels: z.record(z.string(), z.string()).optional() })
    .optional(),
});
const RegistryTokenSchema = z
  .object({
    token: z.string().min(1).optional(),
    access_token: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.token !== undefined || value.access_token !== undefined,
    { message: "registry token response contains no token" },
  );
const BearerChallengeSchema = z.object({
  realm: z.url(),
  service: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
});

type OciAttempt = {
  source: "oci-manifest";
  url: string | undefined;
  outcome: "found" | "unavailable" | "failed";
  detail: string;
};
type OciNote = {
  dependency: string;
  version: string;
  notes: string;
  url: string | undefined;
  source: "oci-manifest";
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

function bearerChallenge(
  header: string | null,
): z.infer<typeof BearerChallengeSchema> | undefined {
  if (header?.toLowerCase().startsWith("bearer ") !== true) {
    return undefined;
  }
  const values: Record<string, string> = {};
  const expression = /(\w+)="([^"]*)"/g;
  let match = expression.exec(header);
  while (match !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) values[key] = value;
    match = expression.exec(header);
  }
  const parsed = BearerChallengeSchema.safeParse(values);
  return parsed.success ? parsed.data : undefined;
}

async function registryFetch(url: string, accept: string): Promise<Response> {
  const initial = await fetchWithTimeout(url, { headers: { Accept: accept } });
  if (initial.status !== 401) return initial;
  const challenge = bearerChallenge(initial.headers.get("www-authenticate"));
  if (challenge === undefined) return initial;
  const tokenUrl = new URL(challenge.realm);
  if (challenge.service !== undefined) {
    tokenUrl.searchParams.set("service", challenge.service);
  }
  if (challenge.scope !== undefined) {
    tokenUrl.searchParams.set("scope", challenge.scope);
  }
  const tokenResponse = await fetchWithTimeout(tokenUrl.href, {
    headers: { Accept: "application/json" },
  });
  if (!tokenResponse.ok) {
    throw new Error(
      `Registry token service returned HTTP ${String(tokenResponse.status)}`,
    );
  }
  const tokenPayload = RegistryTokenSchema.parse(await tokenResponse.json());
  const token = tokenPayload.token ?? tokenPayload.access_token;
  if (token === undefined) {
    throw new Error("registry token response contains no token");
  }
  return fetchWithTimeout(url, {
    headers: { Accept: accept, Authorization: `Bearer ${token}` },
  });
}

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

type OciMetadata = {
  description: string | undefined;
  source: string | undefined;
};

async function ociMetadata(
  registryOrigin: string,
  repository: string,
  reference: string,
  followIndex: boolean,
): Promise<OciMetadata> {
  const manifestUrl = `${registryOrigin}/v2/${repository}/manifests/${encodeURIComponent(reference)}`;
  const response = await registryFetch(manifestUrl, MANIFEST_ACCEPT);
  if (!response.ok) {
    throw new Error(`Registry returned HTTP ${String(response.status)}`);
  }
  const manifest = OciManifestSchema.parse(await response.json());
  const manifestDescription =
    manifest.annotations?.["org.opencontainers.image.description"];
  const manifestSource =
    manifest.annotations?.["org.opencontainers.image.source"];
  if (manifestDescription !== undefined) {
    return { description: manifestDescription, source: manifestSource };
  }
  const child = manifest.manifests?.[0];
  if (followIndex && child !== undefined && manifest.config === undefined) {
    return ociMetadata(registryOrigin, repository, child.digest, false);
  }
  if (manifest.config === undefined) {
    return { description: undefined, source: manifestSource };
  }
  const configUrl = `${registryOrigin}/v2/${repository}/blobs/${manifest.config.digest}`;
  const configResponse = await registryFetch(
    configUrl,
    "application/vnd.oci.image.config.v1+json, application/vnd.docker.container.image.v1+json",
  );
  if (!configResponse.ok) {
    throw new Error(
      `Registry config blob returned HTTP ${String(configResponse.status)}`,
    );
  }
  const labels = OciConfigSchema.parse(await configResponse.json()).config
    ?.Labels;
  return {
    description: labels?.["org.opencontainers.image.description"],
    source: labels?.["org.opencontainers.image.source"] ?? manifestSource,
  };
}

export async function ociManifestAttempt(
  change: DependencyChange,
): Promise<{ attempt: OciAttempt; note: OciNote | undefined }> {
  const registryUrl = change.registryUrl;
  const version = change.newVersion;
  if (registryUrl === undefined || version === undefined) {
    return {
      attempt: {
        source: "oci-manifest",
        url: undefined,
        outcome: "unavailable",
        detail: "Registry URL or image version is missing",
      },
      note: undefined,
    };
  }
  const parsed = new URL(registryUrl);
  const prefix = parsed.pathname.replace(/^\//, "").replace(/\/$/, "");
  const packagePath = change.packageName ?? change.name;
  const repository = prefix === "" ? packagePath : `${prefix}/${packagePath}`;
  const registryOrigin = ["docker.io", "index.docker.io"].includes(parsed.host)
    ? "https://registry-1.docker.io"
    : `${parsed.protocol}//${parsed.host}`;
  const url = `${registryOrigin}/v2/${repository}/manifests/${encodeURIComponent(version)}`;
  try {
    const metadata = await ociMetadata(
      registryOrigin,
      repository,
      version,
      true,
    );
    const description = dependencyNoteText(metadata.description);
    const source = metadata.source;
    return description === undefined
      ? {
          attempt: {
            source: "oci-manifest",
            url: source ?? url,
            outcome: "unavailable",
            detail: "Manifest was readable but had no substantive description",
          },
          note: undefined,
        }
      : {
          attempt: {
            source: "oci-manifest",
            url: source ?? url,
            outcome: "found",
            detail: "Found OCI description metadata",
          },
          note: {
            dependency: change.name,
            version,
            notes: description,
            url: source ?? url,
            source: "oci-manifest",
          },
        };
  } catch (error) {
    return {
      attempt: {
        source: "oci-manifest",
        url,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      note: undefined,
    };
  }
}
