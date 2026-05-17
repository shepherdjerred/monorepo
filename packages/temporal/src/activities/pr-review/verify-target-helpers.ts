import { z } from "zod/v4";

export type ContainerManifestCheckResult = {
  ok: boolean;
  status: number;
  statusText: string;
};

type RegistryInfo = {
  tokenUrl: string;
  service: string;
  apiBase: string;
};

const TokenResponseSchema = z.object({
  token: z.string(),
});

const DependencyRecordSchema = z.record(z.string(), z.string());

const PackageJsonDependencySectionSchema = z.enum([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

type PackageJsonDependencySection = z.infer<
  typeof PackageJsonDependencySectionSchema
>;

const PackageJsonDependencySectionsSchema = z.object({
  dependencies: DependencyRecordSchema.optional(),
  devDependencies: DependencyRecordSchema.optional(),
  optionalDependencies: DependencyRecordSchema.optional(),
  peerDependencies: DependencyRecordSchema.optional(),
});

const REGISTRY_AUTH = new Map<string, RegistryInfo>([
  [
    "docker.io",
    {
      tokenUrl: "https://auth.docker.io/token",
      service: "registry.docker.io",
      apiBase: "https://registry-1.docker.io",
    },
  ],
  [
    "ghcr.io",
    {
      tokenUrl: "https://ghcr.io/token",
      service: "ghcr.io",
      apiBase: "https://ghcr.io",
    },
  ],
  [
    "quay.io",
    {
      tokenUrl: "https://quay.io/v2/auth",
      service: "quay.io",
      apiBase: "https://quay.io",
    },
  ],
]);

function registryInfoFor(registry: string): RegistryInfo | undefined {
  const normalized = registry.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (normalized === "registry-1.docker.io") {
    return REGISTRY_AUTH.get("docker.io");
  }
  return REGISTRY_AUTH.get(normalized);
}

async function getRegistryToken(
  registryInfo: RegistryInfo,
  repository: string,
): Promise<string | undefined> {
  const url = `${registryInfo.tokenUrl}?scope=repository:${repository}:pull&service=${registryInfo.service}`;
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const parsed = TokenResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.token : undefined;
}

export async function checkContainerManifest(input: {
  registry: string;
  repository: string;
  reference: string;
}): Promise<ContainerManifestCheckResult> {
  const registryInfo = registryInfoFor(input.registry);
  if (registryInfo === undefined) {
    return { ok: false, status: -1, statusText: "unsupported registry" };
  }
  const token = await getRegistryToken(registryInfo, input.repository);
  if (token === undefined) {
    return { ok: false, status: -1, statusText: "auth token unavailable" };
  }
  const response = await fetch(
    `${registryInfo.apiBase}/v2/${input.repository}/manifests/${input.reference}`,
    {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: [
          "application/vnd.docker.distribution.manifest.v2+json",
          "application/vnd.docker.distribution.manifest.list.v2+json",
          "application/vnd.oci.image.manifest.v1+json",
          "application/vnd.oci.image.index.v1+json",
        ].join(", "),
      },
    },
  );
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

export function sectionHasDependency(input: {
  raw: unknown;
  section: PackageJsonDependencySection;
  dependencyName: string;
}): boolean {
  const section = PackageJsonDependencySectionSchema.parse(input.section);
  const parsed = PackageJsonDependencySectionsSchema.safeParse(input.raw);
  if (!parsed.success) return false;
  return parsed.data[section]?.[input.dependencyName] !== undefined;
}
