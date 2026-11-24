import path from "node:path";
import { z } from "zod";
import { RESERVED_SLUGS, validateShortSlug } from "#shared/contract.ts";

export type PlatformSiteEntry = {
  readonly short: string;
  readonly targetUrl: string;
  readonly detail: string;
};

const PublicHostnameSchema = z.object({
  hostname: z.string().min(1),
  namespace: z.string().min(1),
  service: z.string().min(1),
});

const StaticSiteSchema = z.object({
  hostname: z.string().min(1),
  bucket: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
});

const PlatformModelSitesSchema = z.object({
  publicHostnames: z.array(PublicHostnameSchema).default([]),
  staticSites: z.array(StaticSiteSchema).default([]),
});

const ROOT_APEX_SLUGS: Readonly<Record<string, string>> = {
  "sjer.red": "sjer",
  "scout-for-lol.com": "scout",
  "ts-mc.net": "tsmc",
  "glitter-boys.com": "glitter-boys",
  "better-skill-capped.com": "bsc",
  "statically-typed.com": "statically-typed",
};

const DOMAIN_SUFFIX_PREFIXES: readonly {
  readonly suffix: string;
  readonly prefix: string;
}[] = [
  { suffix: ".sjer.red", prefix: "" },
  { suffix: ".scout-for-lol.com", prefix: "scout-" },
  { suffix: ".ts-mc.net", prefix: "tsmc-" },
  { suffix: ".glitter-boys.com", prefix: "glitter-boys-" },
  { suffix: ".better-skill-capped.com", prefix: "bsc-" },
  { suffix: ".statically-typed.com", prefix: "statically-typed-" },
];

/**
 * Hostnames declared in `platform-model.json` that are excluded from dynamic
 * `site` discovery:
 * - Retired / duplicate public hostnames (`clauderon.com` 301s to `sjer.red`;
 *   `livemap.ts-mc.net` duplicates `bluemap.ts-mc.net`).
 * - Non-browser webhook / API receivers.
 */
export const EXCLUDED_PLATFORM_HOSTNAMES: ReadonlySet<string> = new Set([
  "clauderon.com",
  "livemap.ts-mc.net",
  "pr-bot.sjer.red",
  "temporal-agent-tasks.sjer.red",
  "temporal-sleep.sjer.red",
  "xcode-cloud-webhook.sjer.red",
]);

function deriveKnownDomainSlug(hostname: string): string | null {
  for (const rule of DOMAIN_SUFFIX_PREFIXES) {
    if (hostname.endsWith(rule.suffix)) {
      const subdomain = hostname
        .slice(0, -rule.suffix.length)
        .replaceAll(".", "-");
      return `${rule.prefix}${subdomain}`;
    }
  }
  return null;
}

function deriveGenericDomainSlug(hostname: string): string | null {
  const labels = hostname.split(".");
  if (labels.length === 2 && labels[0] !== undefined) {
    return labels[0];
  }
  if (labels.length >= 3) {
    const domain = labels.at(-2);
    const sub = labels.slice(0, -2).join("-");
    if (domain !== undefined && sub.length > 0) {
      return `${domain}-${sub}`;
    }
  }
  return null;
}

export function deriveSlugForHostname(rawHostname: string): string | null {
  const hostname = rawHostname.trim().toLowerCase().replace(/\.$/u, "");
  const candidate =
    ROOT_APEX_SLUGS[hostname] ??
    deriveKnownDomainSlug(hostname) ??
    deriveGenericDomainSlug(hostname);
  return candidate !== null && isUsableSiteSlug(candidate) ? candidate : null;
}

function isUsableSiteSlug(slug: string): boolean {
  return (
    slug !== "go" &&
    !RESERVED_SLUGS.has(slug) &&
    validateShortSlug(slug) === null
  );
}

function normalizeModelHostname(rawHostname: string): string {
  return rawHostname.trim().toLowerCase().replace(/\.$/u, "");
}

function addPlatformSite(
  byShort: Map<string, PlatformSiteEntry>,
  rawHostname: string,
  detailForHost: (hostname: string) => string,
): void {
  const hostname = normalizeModelHostname(rawHostname);
  if (EXCLUDED_PLATFORM_HOSTNAMES.has(hostname)) {
    return;
  }
  const short = deriveSlugForHostname(hostname);
  if (short !== null && !byShort.has(short)) {
    byShort.set(short, {
      short,
      targetUrl: `https://${hostname}/`,
      detail: detailForHost(hostname),
    });
  }
}

export function derivePlatformSites(rawModel: unknown): PlatformSiteEntry[] {
  const model = PlatformModelSitesSchema.parse(rawModel);
  const byShort = new Map<string, PlatformSiteEntry>();

  for (const entry of model.publicHostnames) {
    addPlatformSite(
      byShort,
      entry.hostname,
      () => `Public service (${entry.namespace}/${entry.service})`,
    );
  }

  for (const site of model.staticSites) {
    addPlatformSite(
      byShort,
      site.hostname,
      (hostname) => `Static site (${hostname})`,
    );
    for (const alias of site.aliases ?? []) {
      addPlatformSite(
        byShort,
        alias,
        (hostname) => `Static site alias (${hostname})`,
      );
    }
  }

  return [...byShort.values()].sort((left, right) =>
    left.short.localeCompare(right.short),
  );
}

const DEFAULT_PLATFORM_MODEL_PATH = path.resolve(
  import.meta.dir,
  "../../../homelab/src/platform-model.json",
);

export async function loadPlatformSites(
  explicitModelPath?: string,
): Promise<PlatformSiteEntry[]> {
  const configuredEnvPath = Bun.env["GOLINK_PLATFORM_MODEL_PATH"]?.trim();
  const resolvedPath =
    explicitModelPath === undefined || explicitModelPath === ""
      ? configuredEnvPath === undefined || configuredEnvPath === ""
        ? DEFAULT_PLATFORM_MODEL_PATH
        : path.resolve(configuredEnvPath)
      : path.resolve(explicitModelPath);

  const raw: unknown = JSON.parse(await Bun.file(resolvedPath).text());
  return derivePlatformSites(raw);
}
