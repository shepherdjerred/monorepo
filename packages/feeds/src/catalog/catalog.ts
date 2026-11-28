import {
  normalizeAutoReadRules,
  type AutoReadRule,
  type DeclaredFeed,
  type ManagedCategory,
} from "@shepherdjerred/feeds/shared/contract.ts";
import { ESSAY_BLOG_FEEDS } from "./personal-feeds.ts";
import {
  AI_SDK_ONLY_RULE,
  ASTRO_NOISE_RULES,
  BLOG_PRERELEASE_RULE,
  CLOUDFLARE_NOISE_RULES,
  DUCKDB_NOISE_RULES,
  GRAFANA_NOISE_RULES,
  HOME_ASSISTANT_NOISE_RULES,
  INTELLIJ_NOISE_RULES,
  KUBERNETES_NOISE_RULES,
  OPENAI_NOISE_RULES,
  OTEL_NOISE_RULES,
  PATCH_VERSION_RULE,
  POSTHOG_NOISE_RULES,
  PRERELEASE_RULE,
  PRISMA_NOISE_RULES,
  STRICT_RELEASE_RULES,
  TAILSCALE_BLOG_NOISE_RULES,
} from "./rules.ts";

const SECRET_QUERY_PARAM_PATTERN =
  /^(?:access_?token|api_?key|auth|credential|key|passwd|password|secret|token)$/iu;

type FeedExtras = Pick<DeclaredFeed, "description" | "hidden" | "autoRead">;

function engInfra(
  title: string,
  url: string,
  htmlUrl: string,
  extra?: FeedExtras,
): DeclaredFeed {
  return { category: "Engineering & Infra", title, url, htmlUrl, ...extra };
}

function aiFeed(
  title: string,
  url: string,
  htmlUrl: string,
  extra?: FeedExtras,
): DeclaredFeed {
  return { category: "AI", title, url, htmlUrl, ...extra };
}

export const DECLARED_FEEDS: readonly DeclaredFeed[] = [
  // Engineering & Infra (36 feeds)
  engInfra(
    "PostgreSQL News",
    "https://www.postgresql.org/news/pgsql.rss",
    "https://www.postgresql.org/about/news/",
    {
      autoRead: [
        BLOG_PRERELEASE_RULE,
        {
          field: "title",
          pattern: String.raw`(?:\bPostgreSQL \d+\.\d+|\bPGCA\b|\bSponsorship\b|\bPGConf\b)`,
          flags: "i",
        },
      ],
    },
  ),
  engInfra(
    "SQLite Releases",
    "https://sqlite.org/src/timeline.rss?tag=release",
    "https://sqlite.org/changes.html",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "DuckDB Blog",
    "https://duckdb.org/feed.xml",
    "https://duckdb.org/news/",
    { autoRead: DUCKDB_NOISE_RULES },
  ),
  engInfra(
    "Prisma Blog",
    "https://www.prisma.io/blog/rss.xml",
    "https://www.prisma.io/blog",
    { autoRead: PRISMA_NOISE_RULES },
  ),
  engInfra(
    "TypeScript Blog",
    "https://devblogs.microsoft.com/typescript/feed/",
    "https://devblogs.microsoft.com/typescript/",
    {
      description: "The official blog of the TypeScript team.",
      autoRead: BLOG_PRERELEASE_RULE,
    },
  ),
  engInfra(
    "Total TypeScript",
    "https://www.totaltypescript.com/rss.xml",
    "https://www.totaltypescript.com/",
    {
      description:
        "Learn how to use TypeScript to level-up your applications as a web developer through exercise driven self-paced workshops and tutorials hosted by TypeScript wizard Matt Pocock.",
    },
  ),
  engInfra(
    "ESLint Blog",
    "https://eslint.org/feed.xml",
    "https://eslint.org/blog/",
    {
      description: "ESLint release notes and announcements",
      autoRead: [
        BLOG_PRERELEASE_RULE,
        {
          field: "title",
          pattern: String.raw`^ESLint v\d+\.(?:[1-9]\d*\.\d+|0\.[1-9]\d*)\s+released\b`,
          flags: "i",
        },
      ],
    },
  ),
  engInfra("Bun Blog", "https://bun.sh/rss.xml", "https://bun.sh/blog", {
    autoRead: [
      BLOG_PRERELEASE_RULE,
      {
        field: "title",
        pattern: String.raw`^Bun v?\d+\.\d+\.[1-9]\d*\b`,
        flags: "i",
      },
    ],
  }),
  engInfra(
    "Rust Blog",
    "https://blog.rust-lang.org/feed.xml",
    "https://blog.rust-lang.org/",
    {
      autoRead: [
        BLOG_PRERELEASE_RULE,
        {
          field: "title",
          pattern: String.raw`(?:^Announcing (?:Rust \d+\.\d+\.[1-9]\d*\b|rustup\b)|Google Summer of Code|Maintainer in Residence|How to fund|Project Goals|\bSurvey\b)`,
          flags: "i",
        },
      ],
    },
  ),
  engInfra("Go Blog", "https://go.dev/blog/feed.atom", "https://go.dev/blog/"),
  engInfra(
    "Swift Releases",
    "https://github.com/swiftlang/swift/releases.atom",
    "https://github.com/swiftlang/swift/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "Turborepo Releases",
    "https://github.com/vercel/turborepo/releases.atom",
    "https://github.com/vercel/turborepo/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "React Blog",
    "https://react.dev/rss.xml",
    "https://react.dev/blog",
    {
      autoRead: BLOG_PRERELEASE_RULE,
    },
  ),
  engInfra("Vite Blog", "https://vite.dev/blog.rss", "https://vite.dev/blog", {
    description: "Next Generation Frontend Tooling",
    autoRead: BLOG_PRERELEASE_RULE,
  }),
  engInfra(
    "Astro Blog",
    "https://astro.build/rss.xml",
    "https://astro.build/",
    {
      description: "News and updates about Astro.",
      autoRead: ASTRO_NOISE_RULES,
    },
  ),
  engInfra(
    "Hono Releases",
    "https://github.com/honojs/hono/releases.atom",
    "https://github.com/honojs/hono/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "Zod Releases",
    "https://github.com/colinhacks/zod/releases.atom",
    "https://github.com/colinhacks/zod/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "Temporal TypeScript SDK Releases",
    "https://github.com/temporalio/sdk-typescript/releases.atom",
    "https://github.com/temporalio/sdk-typescript/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "OpenTelemetry Blog",
    "https://opentelemetry.io/blog/index.xml",
    "https://opentelemetry.io/blog/",
    { autoRead: OTEL_NOISE_RULES },
  ),
  engInfra(
    "Kubernetes Blog",
    "https://kubernetes.io/feed.xml",
    "https://kubernetes.io/blog/",
    { autoRead: KUBERNETES_NOISE_RULES },
  ),
  engInfra(
    "Argo CD Releases",
    "https://github.com/argoproj/argo-cd/releases.atom",
    "https://github.com/argoproj/argo-cd/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "Helm Blog",
    "https://helm.sh/blog/index.xml",
    "https://helm.sh/blog/",
    { autoRead: BLOG_PRERELEASE_RULE },
  ),
  engInfra(
    "OpenTofu Blog",
    "https://opentofu.org/blog/rss.xml",
    "https://opentofu.org/blog/",
    { autoRead: BLOG_PRERELEASE_RULE },
  ),
  engInfra(
    "Talos Releases",
    "https://github.com/siderolabs/talos/releases.atom",
    "https://github.com/siderolabs/talos/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "Tailscale Blog",
    "https://tailscale.com/blog/index.xml",
    "https://tailscale.com/blog/",
    { autoRead: TAILSCALE_BLOG_NOISE_RULES },
  ),
  engInfra(
    "Tailscale Changelog",
    "https://tailscale.com/changelog/index.xml",
    "https://tailscale.com/changelog",
    {
      autoRead: [
        PRERELEASE_RULE,
        PATCH_VERSION_RULE,
        { field: "title", pattern: String.raw`^DERP server\b`, flags: "i" },
      ],
    },
  ),
  engInfra(
    "Cloudflare Blog",
    "https://blog.cloudflare.com/rss/",
    "https://blog.cloudflare.com/",
    { autoRead: CLOUDFLARE_NOISE_RULES },
  ),
  engInfra(
    "Velero Releases",
    "https://github.com/velero-io/velero/releases.atom",
    "https://github.com/velero-io/velero/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "cdk8s Releases",
    "https://github.com/cdk8s-team/cdk8s/releases.atom",
    "https://github.com/cdk8s-team/cdk8s/releases",
    { autoRead: STRICT_RELEASE_RULES },
  ),
  engInfra(
    "Grafana Blog",
    "https://grafana.com/blog/index.xml",
    "https://grafana.com/blog/",
    { autoRead: GRAFANA_NOISE_RULES },
  ),
  engInfra(
    "Prometheus Blog",
    "https://prometheus.io/blog/feed.xml",
    "https://prometheus.io/blog/",
  ),
  engInfra(
    "PostHog Blog",
    "https://posthog.com/rss.xml",
    "https://posthog.com/blog",
    {
      description: "PostHog engineering blog and product updates",
      autoRead: POSTHOG_NOISE_RULES,
    },
  ),
  engInfra(
    "Home Assistant",
    "https://www.home-assistant.io/atom.xml",
    "https://www.home-assistant.io/",
    { autoRead: HOME_ASSISTANT_NOISE_RULES },
  ),
  engInfra(
    "Krebs on Security",
    "https://krebsonsecurity.com/feed/",
    "https://krebsonsecurity.com/",
    { description: "In-depth security news and investigation" },
  ),
  engInfra(
    "IntelliJ IDEA Blog",
    "https://blog.jetbrains.com/idea/feed/",
    "https://blog.jetbrains.com/",
    {
      description: "Developer Tools for Professionals and Teams",
      hidden: true,
      autoRead: INTELLIJ_NOISE_RULES,
    },
  ),
  engInfra(
    "Visual Studio Code",
    "https://code.visualstudio.com/feed.xml",
    "https://code.visualstudio.com/",
    {
      hidden: true,
      autoRead: {
        field: "title",
        pattern: String.raw`(?:\bInsiders\b|\bWrapped\b|GitHub Universe|\bLivestream\b)`,
        flags: "i",
      },
    },
  ),

  // AI (4 feeds)
  aiFeed(
    "Anthropic Engineering",
    "https://cdn.jsdelivr.net/gh/Olshansk/rss-feeds@main/feeds/feed_anthropic_engineering.xml",
    "https://www.anthropic.com/engineering",
    {
      description:
        "Community-generated RSS feed for Anthropic's Engineering blog, served via jsDelivr.",
    },
  ),
  aiFeed("Cursor Blog", "https://cursor.com/atom.xml", "https://cursor.com/", {
    description: "Compiled notes from the Cursor engineering team",
    autoRead: {
      field: "title",
      pattern: String.raw`(?:^We Raised\b|\bSeries [A-F]\b)`,
      flags: "i",
    },
  }),
  aiFeed(
    "OpenAI News",
    "https://openai.com/news/rss.xml",
    "https://openai.com/news/",
    {
      description:
        "Official OpenAI news feed filtered to research, engineering, models, and security",
      autoRead: OPENAI_NOISE_RULES,
    },
  ),
  aiFeed(
    "Vercel News — AI SDK",
    "https://vercel.com/atom",
    "https://vercel.com/ai-sdk",
    {
      description: "Official Vercel News filtered to AI SDK announcements",
      autoRead: AI_SDK_ONLY_RULE,
    },
  ),

  ...ESSAY_BLOG_FEEDS,
];

function validatePublicCatalogUrl(rawUrl: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${label} URL in catalog: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported protocol for ${label} URL in catalog (${parsed.protocol}): ${rawUrl}`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`Embedded credentials are forbidden in catalog ${label}`);
  }
  for (const [paramName] of parsed.searchParams) {
    if (SECRET_QUERY_PARAM_PATTERN.test(paramName)) {
      throw new Error(
        `Credential-like query parameter "${paramName}" is forbidden in catalog ${label}`,
      );
    }
  }
}

function validateAutoRead(rule: AutoReadRule, feedTitle: string): void {
  const rules = normalizeAutoReadRules(rule);
  if (rules.length === 0) {
    throw new Error(`Empty autoRead rule list on catalog feed "${feedTitle}"`);
  }
  for (const single of rules) {
    if (single.pattern.length === 0) {
      throw new Error(`Empty autoRead pattern on catalog feed "${feedTitle}"`);
    }
    try {
      new RegExp(single.pattern, single.flags).test("");
    } catch (error: unknown) {
      throw new Error(
        `Invalid autoRead regex on catalog feed "${feedTitle}": ${String(error)}`,
        { cause: error },
      );
    }
  }
}

const REQUIRED_MANAGED_CATEGORIES: readonly ManagedCategory[] = [
  "Engineering & Infra",
  "AI",
  "Essays & Personal Blogs",
];

export function validateCatalog(feeds: readonly DeclaredFeed[]): void {
  const counts = new Map<ManagedCategory, number>();
  const seenUrls = new Set<string>();

  for (const feed of feeds) {
    if (feed.title.trim().length === 0) {
      throw new Error(`Catalog feed title cannot be empty (${feed.url})`);
    }
    counts.set(feed.category, (counts.get(feed.category) ?? 0) + 1);

    validatePublicCatalogUrl(feed.url, `feed "${feed.title}"`);
    if (feed.htmlUrl !== undefined) {
      validatePublicCatalogUrl(feed.htmlUrl, `htmlUrl for "${feed.title}"`);
    }

    if (seenUrls.has(feed.url)) {
      throw new Error(`Duplicate feed URL in catalog: ${feed.url}`);
    }
    seenUrls.add(feed.url);

    if (feed.autoRead !== undefined) {
      validateAutoRead(feed.autoRead, feed.title);
    }
  }

  for (const requiredCategory of REQUIRED_MANAGED_CATEGORIES) {
    if ((counts.get(requiredCategory) ?? 0) === 0) {
      throw new Error(
        `Catalog must declare at least one "${requiredCategory}" feed`,
      );
    }
  }
}
