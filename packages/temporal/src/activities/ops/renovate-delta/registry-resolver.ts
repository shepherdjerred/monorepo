import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { z } from "zod";
import { extractGithubOwnerRepoFromText } from "./pr-body-parser.ts";
import { sanitizeHttpsUrl } from "./semver-utils.ts";
import type { ResolvedRenovateCandidate } from "./version-resolver.ts";

const NpmRegistryMetadataSchema = z.object({
  description: z.string().optional(),
  homepage: z.string().optional(),
  repository: z
    .union([
      z.string(),
      z.object({
        url: z.string().optional(),
      }),
    ])
    .optional(),
});

const CratesIoMetadataSchema = z.object({
  crate: z.object({
    description: z.string().nullable().optional(),
    repository: z.string().nullable().optional(),
    homepage: z.string().nullable().optional(),
  }),
});

const PypiMetadataSchema = z.object({
  info: z.object({
    summary: z.string().nullable().optional(),
    home_page: z.string().nullable().optional(),
    project_urls: z.record(z.string(), z.string()).nullable().optional(),
  }),
});

export type UpstreamRepoIdentity = {
  readonly owner: string;
  readonly name: string;
};

export type ResolvedRegistryInfo = {
  readonly githubRepo: UpstreamRepoIdentity | undefined;
  readonly metadataSummary: string | undefined;
  readonly homepageUrl: string | undefined;
};

function nonEmptyTrimmed(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function splitOwnerRepo(
  slug: string | undefined,
): UpstreamRepoIdentity | undefined {
  if (slug === undefined) {
    return undefined;
  }
  const cleaned = slug
    .trim()
    .replace(/^(?:ghcr\.io|quay\.io|docker\.io|aqua|github|cargo)[:/]/iu, "")
    .replace(/\.git$/iu, "");
  if (cleaned.startsWith("@") || cleaned.startsWith("library/")) {
    return undefined;
  }
  const parts = cleaned.split("/");
  if (parts.length !== 2) {
    return undefined;
  }
  const [owner, name] = parts;
  return owner !== undefined &&
    name !== undefined &&
    owner !== "" &&
    name !== "" &&
    /^[\w.-]+$/u.test(owner) &&
    /^[\w.-]+$/u.test(name)
    ? { owner, name }
    : undefined;
}

function parseRepoUrlToOwnerRepo(
  rawUrl: string | undefined,
): UpstreamRepoIdentity | undefined {
  if (rawUrl === undefined || rawUrl === "") {
    return undefined;
  }
  const normalized = rawUrl
    .trim()
    .replace(/^git\+/iu, "")
    .replace(/^git:\/\/github\.com\//iu, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//iu, "https://github.com/")
    .replace(/^git@github\.com:/iu, "https://github.com/");
  return splitOwnerRepo(extractGithubOwnerRepoFromText(normalized, ""));
}

async function fetchJsonSafely<T extends z.ZodType>(
  url: string,
  schema: T,
  fetchImpl: Fetch,
): Promise<z.infer<T> | undefined> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "shepherdjerred-temporal-renovate-delta/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? schema.parse(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

async function lookupNpmMetadata(
  packageName: string,
  fetchImpl: Fetch,
): Promise<ResolvedRegistryInfo | undefined> {
  const encoded = packageName.startsWith("@")
    ? `@${encodeURIComponent(packageName.slice(1))}`
    : encodeURIComponent(packageName);
  const doc = await fetchJsonSafely(
    `https://registry.npmjs.org/${encoded}`,
    NpmRegistryMetadataSchema,
    fetchImpl,
  );
  if (doc === undefined) {
    return undefined;
  }
  const repoRaw =
    typeof doc.repository === "string" ? doc.repository : doc.repository?.url;
  return {
    githubRepo:
      parseRepoUrlToOwnerRepo(repoRaw) ?? parseRepoUrlToOwnerRepo(doc.homepage),
    metadataSummary: nonEmptyTrimmed(doc.description),
    homepageUrl: sanitizeHttpsUrl(doc.homepage),
  };
}

async function lookupCratesMetadata(
  packageName: string,
  fetchImpl: Fetch,
): Promise<ResolvedRegistryInfo | undefined> {
  if (packageName.includes("/") || packageName.startsWith("@")) {
    return undefined;
  }
  const doc = await fetchJsonSafely(
    `https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`,
    CratesIoMetadataSchema,
    fetchImpl,
  );
  if (doc === undefined) {
    return undefined;
  }
  return {
    githubRepo:
      parseRepoUrlToOwnerRepo(doc.crate.repository ?? undefined) ??
      parseRepoUrlToOwnerRepo(doc.crate.homepage ?? undefined),
    metadataSummary: nonEmptyTrimmed(doc.crate.description),
    homepageUrl: sanitizeHttpsUrl(doc.crate.homepage ?? undefined),
  };
}

async function lookupPypiMetadata(
  packageName: string,
  fetchImpl: Fetch,
): Promise<ResolvedRegistryInfo | undefined> {
  if (packageName.includes("/") || packageName.startsWith("@")) {
    return undefined;
  }
  const doc = await fetchJsonSafely(
    `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
    PypiMetadataSchema,
    fetchImpl,
  );
  if (doc === undefined) {
    return undefined;
  }
  const projectUrls = Object.values(doc.info.project_urls ?? {});
  let githubRepo = parseRepoUrlToOwnerRepo(doc.info.home_page ?? undefined);
  for (const url of projectUrls) {
    githubRepo ??= parseRepoUrlToOwnerRepo(url);
  }
  return {
    githubRepo,
    metadataSummary: nonEmptyTrimmed(doc.info.summary),
    homepageUrl: sanitizeHttpsUrl(doc.info.home_page ?? undefined),
  };
}

function resolveDirectGithubRepo(
  candidate: ResolvedRenovateCandidate,
): UpstreamRepoIdentity | undefined {
  const prRepo = candidate.parsedPrBody?.changes.find(
    (c) => c.upstreamGithubRepo !== undefined,
  )?.upstreamGithubRepo;
  const explicitRepo = splitOwnerRepo(
    prRepo ?? candidate.repoPin?.upstreamGithubRepo,
  );
  if (explicitRepo !== undefined) {
    return explicitRepo;
  }

  if (
    candidate.ecosystem === "terraform" ||
    candidate.ecosystem === "terraform-provider"
  ) {
    const tfParts = splitOwnerRepo(candidate.packageName);
    if (tfParts !== undefined) {
      const repoName = tfParts.name.startsWith("terraform-provider-")
        ? tfParts.name
        : `terraform-provider-${tfParts.name}`;
      return { owner: tfParts.owner, name: repoName };
    }
  }

  const direct = splitOwnerRepo(candidate.packageName);
  if (direct !== undefined) {
    return direct;
  }
  for (const alias of candidate.repoPin?.aliases ?? []) {
    const aliasRepo = splitOwnerRepo(alias);
    if (aliasRepo !== undefined) {
      return aliasRepo;
    }
  }
  return undefined;
}

async function lookupByEcosystem(
  packageName: string,
  ecosystem: string,
  fetchImpl: Fetch,
): Promise<ResolvedRegistryInfo | undefined> {
  const lower = ecosystem.toLowerCase();
  if (lower === "rust" || lower === "cargo") {
    return await lookupCratesMetadata(packageName, fetchImpl);
  }
  return lower === "python" || lower === "pypi" || lower === "pip"
    ? await lookupPypiMetadata(packageName, fetchImpl)
    : ((await lookupNpmMetadata(packageName, fetchImpl)) ??
        (await lookupCratesMetadata(packageName, fetchImpl)) ??
        (await lookupPypiMetadata(packageName, fetchImpl)));
}

export async function resolveUpstreamRegistryInfo(input: {
  readonly candidate: ResolvedRenovateCandidate;
  readonly fetchImpl?: Fetch;
}): Promise<ResolvedRegistryInfo> {
  const { candidate } = input;
  const directRepo = resolveDirectGithubRepo(candidate);
  const fallback: ResolvedRegistryInfo = {
    githubRepo: directRepo,
    metadataSummary: candidate.repoPin?.overrideNotes,
    homepageUrl: candidate.repoPin?.overrideUrl,
  };
  return directRepo === undefined
    ? ((await lookupByEcosystem(
        candidate.packageName,
        candidate.ecosystem,
        input.fetchImpl ?? fetch,
      )) ?? fallback)
    : fallback;
}
