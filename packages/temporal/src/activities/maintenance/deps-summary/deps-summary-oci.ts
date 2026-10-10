import { z } from "zod/v4";
import type { DependencyChange } from "#shared/deps-summary-types.ts";
import { dependencyNoteText } from "./deps-summary-text.ts";

const OciDescriptorSchema = z.object({
  digest: z.string().min(1),
  platform: z
    .object({ architecture: z.string().min(1), os: z.string().min(1) })
    .optional(),
});
const OciManifestSchema = z.object({
  annotations: z.record(z.string(), z.string()).optional(),
  config: OciDescriptorSchema.optional(),
  manifests: z.array(OciDescriptorSchema).optional(),
});
const OciConfigSchema = z.object({
  config: z
    .object({
      Labels: z.record(z.string(), z.string()).optional(),
      Env: z.array(z.string()).optional(),
    })
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
  revision: string | undefined;
};

function configMetadata(
  config: z.infer<typeof OciConfigSchema>["config"],
  manifest: OciMetadata,
): OciMetadata {
  const labels = config?.Labels;
  const source = labels?.["org.opencontainers.image.source"] ?? manifest.source;
  const buildRevisions = (config?.Env ?? [])
    .filter((value) => value.startsWith("GIT_SHA="))
    .map((value) => value.slice(8));
  if (new Set(buildRevisions).size > 1) {
    throw new Error("OCI build revision declarations disagree");
  }
  return {
    description:
      labels?.["org.opencontainers.image.description"] ?? manifest.description,
    source,
    // First-party images can inherit the base image's revision LABEL while
    // replacing its source LABEL. Only the application's baked build identity
    // proves its source revision; an inherited label is not that evidence.
    revision:
      source === "https://github.com/shepherdjerred/monorepo"
        ? buildRevisions[0]
        : (manifest.revision ?? labels?.["org.opencontainers.image.revision"]),
  };
}

export async function ociMetadata(
  registryOrigin: string,
  repository: string,
  reference: string,
  options: { followIndex: boolean; inherited?: OciMetadata },
): Promise<OciMetadata> {
  const { followIndex, inherited } = options;
  const manifestUrl = `${registryOrigin}/v2/${repository}/manifests/${encodeURIComponent(reference)}`;
  const response = await registryFetch(manifestUrl, MANIFEST_ACCEPT);
  if (!response.ok) {
    throw new Error(`Registry returned HTTP ${String(response.status)}`);
  }
  const manifest = OciManifestSchema.parse(await response.json());
  const manifestDescription =
    manifest.annotations?.["org.opencontainers.image.description"] ??
    inherited?.description;
  const manifestSource =
    manifest.annotations?.["org.opencontainers.image.source"] ??
    inherited?.source;
  const manifestRevision =
    manifest.annotations?.["org.opencontainers.image.revision"] ??
    inherited?.revision;
  if (followIndex && manifest.manifests !== undefined) {
    // Buildx indexes can put unknown/unknown attestation manifests first.
    // Only a concrete image platform can carry application build metadata.
    const child = manifest.manifests.find(
      (entry) =>
        entry.platform !== undefined &&
        entry.platform.architecture !== "unknown" &&
        entry.platform.os !== "unknown",
    );
    if (child === undefined) {
      throw new Error("OCI index contains no concrete image platform");
    }
    return ociMetadata(registryOrigin, repository, child.digest, {
      followIndex: false,
      inherited: {
        description: manifestDescription,
        source: manifestSource,
        revision: manifestRevision,
      },
    });
  }
  if (manifest.config === undefined) {
    return {
      description: manifestDescription,
      source: manifestSource,
      revision:
        manifestSource === "https://github.com/shepherdjerred/monorepo"
          ? undefined
          : manifestRevision,
    };
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
  const config = OciConfigSchema.parse(await configResponse.json()).config;
  return configMetadata(config, {
    description: manifestDescription,
    source: manifestSource,
    revision: manifestRevision,
  });
}

export function ociImageLocation(
  change: DependencyChange,
  value: string | undefined,
): {
  registryOrigin: string;
  repository: string;
  reference: string;
} {
  if (value === undefined || change.registryUrl === undefined) {
    throw new Error("Registry URL or image value is missing");
  }
  const parsed = new URL(change.registryUrl);
  const prefix = parsed.pathname.replace(/^\//, "").replace(/\/$/, "");
  const packagePath = change.packageName ?? change.name;
  const repository = prefix === "" ? packagePath : `${prefix}/${packagePath}`;
  const digest = /@(sha256:[a-f0-9]{64})$/.exec(value)?.[1];
  return {
    registryOrigin: ["docker.io", "index.docker.io"].includes(parsed.host)
      ? "https://registry-1.docker.io"
      : parsed.origin,
    repository,
    reference: digest ?? value,
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
  const { registryOrigin, repository, reference } = ociImageLocation(
    change,
    change.newValue ?? version,
  );
  const url = `${registryOrigin}/v2/${repository}/manifests/${encodeURIComponent(reference)}`;
  try {
    const metadata = await ociMetadata(registryOrigin, repository, reference, {
      followIndex: true,
    });
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
