import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { z } from "zod";
import { extractGithubOwnerRepoFromText } from "./pr-body-parser.ts";
import {
  normalizeImageRepo,
  normalizeVersionString,
  sanitizeHttpsUrl,
} from "./semver-utils.ts";

const VersionCatalogSchema = z.object({
  entries: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      category: z.string().optional(),
      artifactType: z.string().optional(),
      management: z
        .object({
          managed: z.boolean(),
          datasource: z.string().optional(),
          registryUrl: z.string().optional(),
          packageName: z.string().optional(),
        })
        .optional(),
      releaseNotesOverride: z
        .object({
          url: z.string().optional(),
          summary: z.string(),
        })
        .optional(),
    }),
  ),
});

const RootPackageJsonSchema = z.object({
  packageManager: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
});

const TofuProvidersSchema = z.object({
  providers: z.array(
    z.object({
      registryUrl: z.string().optional(),
      source: z.string(),
      version: z.string(),
    }),
  ),
});

export type RepoPinEntry = {
  readonly pinnedVersion: string;
  readonly consumers: readonly string[];
  readonly aliases: readonly string[];
  readonly datasource?: string | undefined;
  readonly registryUrl?: string | undefined;
  readonly upstreamGithubRepo?: string | undefined;
  readonly overrideNotes?: string | undefined;
  readonly overrideUrl?: string | undefined;
};

export type MainRepoManifests = {
  readonly byKey: ReadonlyMap<string, RepoPinEntry>;
};

export const EMPTY_REPO_MANIFESTS: MainRepoManifests = {
  byKey: new Map(),
};

function cleanNpmSpec(spec: string): string | null {
  const trimmed = spec.trim();
  if (trimmed.startsWith("workspace:")) {
    return null;
  }
  const npmAlias = /^npm:[^@]+@(.+)$/u.exec(trimmed);
  const target = (npmAlias?.[1] ?? trimmed).replace(/^[~^>=<\s]+/u, "");
  return normalizeVersionString(target);
}

function registerPin(
  map: Map<string, RepoPinEntry>,
  keys: readonly string[],
  entry: RepoPinEntry,
): void {
  for (const rawKey of keys) {
    const key = rawKey.trim().toLowerCase();
    if (key === "") {
      continue;
    }
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, entry);
      continue;
    }
    map.set(key, {
      ...existing,
      consumers: [...new Set([...existing.consumers, ...entry.consumers])],
      aliases: [...new Set([...existing.aliases, ...entry.aliases])],
    });
  }
}

export function parseCatalogManifest(
  rawJson: string,
  target: Map<string, RepoPinEntry>,
): void {
  const parsed = VersionCatalogSchema.parse(JSON.parse(rawJson));
  for (const item of parsed.entries) {
    const pinnedVersion = normalizeVersionString(item.value);
    if (pinnedVersion === null) {
      continue;
    }
    const mgmtPkg = item.management?.packageName;
    const aliases = [
      item.name,
      normalizeImageRepo(item.name),
      ...(mgmtPkg === undefined ? [] : [mgmtPkg, normalizeImageRepo(mgmtPkg)]),
    ];
    const overrideRepo =
      item.releaseNotesOverride?.url === undefined
        ? undefined
        : extractGithubOwnerRepoFromText(item.releaseNotesOverride.url, "");
    registerPin(target, aliases, {
      pinnedVersion,
      consumers: ["version-catalog", "packages/homelab"],
      aliases: [...new Set(aliases)],
      datasource: item.management?.datasource,
      registryUrl: item.management?.registryUrl,
      upstreamGithubRepo: overrideRepo,
      overrideNotes: item.releaseNotesOverride?.summary,
      overrideUrl: sanitizeHttpsUrl(item.releaseNotesOverride?.url),
    });
  }
}

export function parseRootPackageJsonManifest(
  rawJson: string,
  target: Map<string, RepoPinEntry>,
): void {
  const parsed = RootPackageJsonSchema.parse(JSON.parse(rawJson));
  registerPackageManagerPin(parsed.packageManager, target);
  const sections = [
    parsed.dependencies ?? {},
    parsed.devDependencies ?? {},
    parsed.overrides ?? {},
  ];
  for (const deps of sections) {
    for (const [pkg, spec] of Object.entries(deps)) {
      const ver = cleanNpmSpec(spec);
      if (ver !== null) {
        registerPin(target, [pkg], {
          pinnedVersion: ver,
          consumers: ["package.json"],
          aliases: [pkg],
          datasource: "npm",
        });
      }
    }
  }
}

function registerPackageManagerPin(
  packageManager: string | undefined,
  target: Map<string, RepoPinEntry>,
): void {
  if (packageManager === undefined) {
    return;
  }
  const atIdx = packageManager.indexOf("@");
  if (atIdx <= 0) {
    return;
  }
  const name = packageManager.slice(0, atIdx);
  const ver = normalizeVersionString(packageManager.slice(atIdx + 1));
  if (ver !== null) {
    registerPin(target, [name], {
      pinnedVersion: ver,
      consumers: ["package.json"],
      aliases: [name],
      datasource: "npm",
    });
  }
}

export function parseTofuProvidersManifest(
  rawJson: string,
  target: Map<string, RepoPinEntry>,
): void {
  const parsed = TofuProvidersSchema.parse(JSON.parse(rawJson));
  for (const provider of parsed.providers) {
    const ver = normalizeVersionString(provider.version);
    if (ver === null) {
      continue;
    }
    const keys = [
      provider.source,
      ...(provider.registryUrl === undefined
        ? []
        : [
            `${provider.registryUrl.replace(/^https?:\/\//u, "")}/${provider.source}`,
          ]),
    ];
    registerPin(target, keys, {
      pinnedVersion: ver,
      consumers: ["packages/homelab", "packages/homelab-cdktn"],
      aliases: keys,
      datasource: "terraform-provider",
      registryUrl: provider.registryUrl,
    });
  }
}

function registerMiseToolLine(
  trimmed: string,
  pendingHintDep: string | undefined,
  target: Map<string, RepoPinEntry>,
): void {
  const parsedLine = parseMiseToolAssignment(trimmed);
  if (parsedLine === undefined) {
    return;
  }
  const strippedKey = parsedLine.key.replace(/^(?:aqua|cargo|github):/iu, "");
  const keys = [
    parsedLine.key,
    strippedKey,
    ...(pendingHintDep === undefined ? [] : [pendingHintDep]),
  ];
  registerPin(target, keys, {
    pinnedVersion: parsedLine.version,
    consumers: [".mise.toml"],
    aliases: [...new Set(keys)],
    upstreamGithubRepo:
      strippedKey.includes("/") && !strippedKey.startsWith("@")
        ? strippedKey
        : undefined,
  });
}

export function parseMiseTomlManifest(
  rawToml: string,
  target: Map<string, RepoPinEntry>,
): void {
  const lines = rawToml.split(/\r?\n/u);
  let pendingHintDep: string | undefined;
  let inTools = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inTools = trimmed === "[tools]";
      pendingHintDep = undefined;
      continue;
    }
    const hintMatch = /^#\s*renovate:.*?\bdepName=(\S+)/u.exec(trimmed);
    if (hintMatch?.[1] !== undefined) {
      pendingHintDep = hintMatch[1];
      continue;
    }
    if (inTools && trimmed !== "" && !trimmed.startsWith("#")) {
      registerMiseToolLine(trimmed, pendingHintDep, target);
      pendingHintDep = undefined;
    }
  }
}

function parseMiseToolAssignment(
  trimmed: string,
): { key: string; version: string } | undefined {
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) {
    return undefined;
  }
  const key = trimmed.slice(0, eqIdx).trim().replaceAll('"', "");
  const rhs = trimmed.slice(eqIdx + 1).trim();
  const direct = /^"([^"]+)"/u.exec(rhs);
  const inlineVersion = /version\s*=\s*"([^"]+)"/u.exec(rhs);
  const rawVer = direct?.[1] ?? inlineVersion?.[1];
  const version = normalizeVersionString(rawVer);
  return key === "" || version === null ? undefined : { key, version };
}

async function fetchRepoRawFile(input: {
  readonly owner: string;
  readonly name: string;
  readonly path: string;
  readonly token: string;
  readonly fetchImpl: Fetch;
}): Promise<string | undefined> {
  const url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/contents/${input.path}?ref=main`;
  const response = await input.fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${input.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok ? await response.text() : undefined;
}

export async function fetchMainRepoManifests(input: {
  readonly owner: string;
  readonly name: string;
  readonly token: () => Promise<string>;
  readonly fetchImpl?: Fetch;
}): Promise<MainRepoManifests> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const authToken = await input.token();
  const [catalogRaw, pkgRaw, miseRaw, tofuRaw] = await Promise.all([
    fetchRepoRawFile({
      owner: input.owner,
      name: input.name,
      path: "packages/version-catalog/src/catalog.json",
      token: authToken,
      fetchImpl,
    }),
    fetchRepoRawFile({
      owner: input.owner,
      name: input.name,
      path: "package.json",
      token: authToken,
      fetchImpl,
    }),
    fetchRepoRawFile({
      owner: input.owner,
      name: input.name,
      path: ".mise.toml",
      token: authToken,
      fetchImpl,
    }),
    fetchRepoRawFile({
      owner: input.owner,
      name: input.name,
      path: "packages/homelab/src/tofu/provider-versions.json",
      token: authToken,
      fetchImpl,
    }),
  ]);

  const byKey = new Map<string, RepoPinEntry>();
  if (catalogRaw !== undefined) {
    parseCatalogManifest(catalogRaw, byKey);
  }
  if (tofuRaw !== undefined) {
    parseTofuProvidersManifest(tofuRaw, byKey);
  }
  if (miseRaw !== undefined) {
    parseMiseTomlManifest(miseRaw, byKey);
  }
  if (pkgRaw !== undefined) {
    parseRootPackageJsonManifest(pkgRaw, byKey);
  }
  return { byKey };
}

export function lookupRepoPin(
  manifests: MainRepoManifests,
  packageName: string,
): RepoPinEntry | undefined {
  return (
    manifests.byKey.get(packageName.trim().toLowerCase()) ??
    manifests.byKey.get(normalizeImageRepo(packageName))
  );
}
