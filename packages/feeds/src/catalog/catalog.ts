import type {
  AutoReadRule,
  DeclaredFeed,
} from "@shepherdjerred/feeds/shared/contract.ts";

export const PRERELEASE_RULE: AutoReadRule = {
  field: "title",
  pattern: String.raw`\b(alpha|beta|rc|canary|dev|nightly|preview|pre)\b`,
  flags: "i",
};

export const AI_SDK_ONLY_RULE: AutoReadRule = {
  field: "title",
  pattern: String.raw`\bAI SDK\b`,
  flags: "i",
  negate: true,
};

const SECRET_QUERY_PARAM_PATTERN =
  /^(?:access_?token|api_?key|auth|credential|key|passwd|password|secret|token)$/iu;

type FeedExtras = Pick<DeclaredFeed, "description" | "hidden" | "autoRead">;

function repoStack(
  title: string,
  url: string,
  htmlUrl: string,
  extra?: FeedExtras,
): DeclaredFeed {
  return { category: "Repo Stack", title, url, htmlUrl, ...extra };
}

function blog(
  title: string,
  url: string,
  htmlUrl: string,
  extra?: FeedExtras,
): DeclaredFeed {
  return { category: "Blogs", title, url, htmlUrl, ...extra };
}

const LUDICITY_DESCRIPTION =
  "<blockquote>\r\n\r\n\"While I'm deeply sympathetic, the author should be discussing their issues with a therapist rather than spreading this on the internet.\"\r\n</blockquote>\r\n\r\nI'm also trying out Unoffice Hours, where anyone can book time with me.\r\n<ol>\r\n<li>If you're just a reader that wants to chat about whatever, you can grab me at this link. Don't pick crazy hours for yourself — you'll oversleep and have booked my calendar for no reason!</li>\r\n<li>If you want to chat and might buy consulting one day, you can use this link, which is exactly the same as the previous link but with more availability. It's just a social call, so it's honour system rules on not using it to sneak extra time from my calendar.</li>\r\n<li>If you live in Melbourne, this final link straight-up arranges an in-person meeting at a nice coffee place.</li>\r\n</ol>\r\n\r\nI read all mail without exception, and love getting it. I may not respond, but I'll always read! You can reach me at: ludicity.hackernews@gmail.com.\r\n\r\nMy podcast, \"Does A Frog Have Scorpion Nature\", where I talk to people I like, and sometimes find blog post inspiration.\r\n\r\nYou can also catch me on Mastodon.\r\n\r\nLiberapay | Patreon to support me writing taking time off to write amidst the difficulty of launching a business.\r\n\r\nI looked at some code in late 2024 which was so hideous that I rage-quit my job on the spot and started an IT consultancy, Hermit Tech. We sell the voice of reason to companies, especially on data-related issues. You can always book time with us to talk about your problems! I've worked with some readers before and everyone had a good time. We have some bold, innovative technology, such as not lying, explaining things clearly, and listening to people.";

export const DECLARED_FEEDS: readonly DeclaredFeed[] = [
  // Repo Stack (35 feeds; FreshRSS Releases retired)
  repoStack(
    "Anthropic Engineering (community RSS)",
    "https://cdn.jsdelivr.net/gh/Olshansk/rss-feeds@main/feeds/feed_anthropic_engineering.xml",
    "https://www.anthropic.com/engineering",
    {
      description:
        "Community-generated RSS feed for Anthropic's Engineering blog. Served via jsDelivr because raw.githubusercontent.com returns text/plain, which FreshRSS rejects as not a feed.",
    },
  ),
  repoStack(
    "PostgreSQL News",
    "https://www.postgresql.org/news/pgsql.rss",
    "https://www.postgresql.org/about/news/",
  ),
  repoStack(
    "SQLite Releases",
    "https://sqlite.org/src/timeline.rss?tag=release",
    "https://sqlite.org/changes.html",
  ),
  repoStack(
    "DuckDB Blog",
    "https://duckdb.org/feed.xml",
    "https://duckdb.org/news/",
  ),
  repoStack(
    "Prisma Blog",
    "https://www.prisma.io/blog/rss.xml",
    "https://www.prisma.io/blog",
  ),
  repoStack(
    "TypeScript Blog",
    "https://devblogs.microsoft.com/typescript/feed/",
    "https://devblogs.microsoft.com/typescript/",
    { description: "The official blog of the TypeScript team." },
  ),
  repoStack(
    "Total TypeScript",
    "https://www.totaltypescript.com/rss.xml",
    "https://www.totaltypescript.com/",
    {
      description:
        "Learn how to use TypeScript to level-up your applications as a web developer through exercise driven self-paced workshops and tutorials hosted by TypeScript wizard Matt Pocock.",
    },
  ),
  repoStack(
    "ESLint Blog",
    "https://eslint.org/feed.xml",
    "https://eslint.org/blog/",
    { description: "ESLint release notes and announcements" },
  ),
  repoStack("Bun Blog", "https://bun.sh/rss.xml", "https://bun.sh/blog"),
  repoStack(
    "Rust Blog",
    "https://blog.rust-lang.org/feed.xml",
    "https://blog.rust-lang.org/",
  ),
  repoStack("Go Blog", "https://go.dev/blog/feed.atom", "https://go.dev/blog/"),
  repoStack(
    "Swift Releases",
    "https://github.com/swiftlang/swift/releases.atom",
    "https://github.com/swiftlang/swift/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "Turborepo Releases",
    "https://github.com/vercel/turborepo/releases.atom",
    "https://github.com/vercel/turborepo/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "React Blog",
    "https://react.dev/rss.xml",
    "https://react.dev/blog",
  ),
  repoStack("Vite Blog", "https://vite.dev/blog.rss", "https://vite.dev/blog", {
    description: "Next Generation Frontend Tooling",
  }),
  repoStack(
    "Astro Blog",
    "https://astro.build/rss.xml",
    "https://astro.build/",
    {
      description: "News and updates about Astro.",
    },
  ),
  repoStack(
    "Hono Releases",
    "https://github.com/honojs/hono/releases.atom",
    "https://github.com/honojs/hono/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "Zod Releases",
    "https://github.com/colinhacks/zod/releases.atom",
    "https://github.com/colinhacks/zod/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "Temporal TypeScript SDK Releases",
    "https://github.com/temporalio/sdk-typescript/releases.atom",
    "https://github.com/temporalio/sdk-typescript/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "OpenTelemetry Blog",
    "https://opentelemetry.io/blog/index.xml",
    "https://opentelemetry.io/blog/",
  ),
  repoStack(
    "Kubernetes Blog",
    "https://kubernetes.io/feed.xml",
    "https://kubernetes.io/blog/",
  ),
  repoStack(
    "Argo CD Releases",
    "https://github.com/argoproj/argo-cd/releases.atom",
    "https://github.com/argoproj/argo-cd/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "Helm Blog",
    "https://helm.sh/blog/index.xml",
    "https://helm.sh/blog/",
  ),
  repoStack(
    "OpenTofu Blog",
    "https://opentofu.org/blog/rss.xml",
    "https://opentofu.org/blog/",
  ),
  repoStack(
    "Talos Releases",
    "https://github.com/siderolabs/talos/releases.atom",
    "https://github.com/siderolabs/talos/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "Tailscale Blog",
    "https://tailscale.com/blog/index.xml",
    "https://tailscale.com/blog/",
  ),
  repoStack(
    "Tailscale Changelog",
    "https://tailscale.com/changelog/index.xml",
    "https://tailscale.com/changelog",
  ),
  repoStack(
    "Cloudflare Blog",
    "https://blog.cloudflare.com/rss/",
    "https://blog.cloudflare.com/",
  ),
  repoStack(
    "Velero Releases",
    "https://github.com/velero-io/velero/releases.atom",
    "https://github.com/velero-io/velero/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "cdk8s Releases",
    "https://github.com/cdk8s-team/cdk8s/releases.atom",
    "https://github.com/cdk8s-team/cdk8s/releases",
    { autoRead: PRERELEASE_RULE },
  ),
  repoStack(
    "Grafana Blog",
    "https://grafana.com/blog/index.xml",
    "https://grafana.com/blog/",
  ),
  repoStack(
    "Prometheus Blog",
    "https://prometheus.io/blog/feed.xml",
    "https://prometheus.io/blog/",
  ),
  repoStack(
    "PostHog Blog",
    "https://posthog.com/rss.xml",
    "https://posthog.com/blog",
    { description: "PostHog engineering blog and product updates" },
  ),
  repoStack(
    "Vercel News — AI SDK",
    "https://vercel.com/atom",
    "https://vercel.com/ai-sdk",
    {
      description: "Official Vercel News filtered to AI SDK announcements",
      autoRead: AI_SDK_ONLY_RULE,
    },
  ),
  repoStack(
    "OpenAI News",
    "https://openai.com/news/rss.xml",
    "https://openai.com/news/",
    {
      description: "Official OpenAI news feed, including Engineering posts",
    },
  ),

  // Blogs (30 feeds migrated from FreshRSS Uncategorized)
  blog(
    "Andreas Kling",
    "https://awesomekling.github.io/feed.xml",
    "https://awesomekling.github.io/",
    { description: "I like computers!" },
  ),
  blog(
    "Bartosz Ciechanowski",
    "https://ciechanow.ski/atom.xml",
    "https://ciechanow.ski/",
    { description: "Recent content on Bartosz Ciechanowski" },
  ),
  blog(
    "bookbear express",
    "https://www.avabear.xyz/feed",
    "https://www.avabear.xyz/",
    { description: "help-self" },
  ),
  blog(
    "Brandur Leach",
    "https://brandur.org/articles.atom",
    "https://brandur.org/",
    {
      description: "Brandur Leach's essays on software, systems, and databases",
    },
  ),
  blog("brr", "https://brr.fyi/feed.xml", "https://brr.fyi/", {
    description:
      "Observations on US Antarctic infrastructure. Anecdotes from daily life for USAP support staff. Focused on McMurdo Station and Amundsen-Scott South Pole Station.",
  }),
  blog(
    "Cursor Blog | RSS Feed",
    "https://cursor.com/atom.xml",
    "https://cursor.com/",
    { description: "Compiled notes from the team" },
  ),
  blog(
    "Drew DeVault's blog",
    "https://drewdevault.com/blog/index.xml",
    "https://drewdevault.com/",
    { description: "Recent content in Blogs on Drew DeVault's blog" },
  ),
  blog(
    "Eli Bendersky's website",
    "https://eli.thegreenplace.net/feeds/all.atom.xml",
    "https://eli.thegreenplace.net/",
  ),
  blog(
    "Escaping Flatland",
    "https://www.henrikkarlsson.xyz/feed",
    "https://www.henrikkarlsson.xyz/",
    {
      description:
        "I write essays about relationships, thought, and agency. I hang with our kids. We live on a pine covered island in the Baltic Sea. That's about it.",
    },
  ),
  blog(
    "Explained from First Principles",
    "https://explained-from-first-principles.com/feed.xml",
    "https://explained-from-first-principles.com/",
    {
      description:
        "Explained from First Principles is a technology, science, and philosophy blog for curious people.",
    },
  ),
  blog(
    "Factorio Blog",
    "https://www.factorio.com/blog/rss",
    "https://www.factorio.com/",
  ),
  blog(
    "fasterthanli.me",
    "https://fasterthanli.me/index.xml",
    "https://fasterthanli.me/",
    { description: "amos likes to tinker" },
  ),
  blog(
    "Home Assistant",
    "https://www.home-assistant.io/atom.xml",
    "https://www.home-assistant.io/",
  ),
  blog("Dan Luu", "https://danluu.com/atom.xml", "https://danluu.com/", {
    description: "Dan Luu's articles on systems, hardware, and engineering",
  }),
  blog(
    "IntelliJ IDEA : IntelliJ IDEA – the IDE for Professional Development in Java and Kotlin | The JetBrains Blog",
    "https://blog.jetbrains.com/idea/feed/",
    "https://blog.jetbrains.com/",
    {
      description: "Developer Tools for Professionals and Teams",
      hidden: true,
    },
  ),
  blog(
    "jakelazaroff.com",
    "https://jakelazaroff.com/rss.xml",
    "https://jakelazaroff.com/",
    {
      description:
        "Just a programmer trying to make a home for myself on the WWW.",
    },
  ),
  blog("Jerred's Blog", "https://sjer.red/rss.xml", "https://sjer.red/", {
    description: "My personal blog",
  }),
  blog(
    "Joel on Software",
    "https://www.joelonsoftware.com/feed/",
    "https://www.joelonsoftware.com/",
  ),
  blog("Julia Evans", "https://jvns.ca/atom.xml", "http://jvns.ca/"),
  blog(
    "Kalzumeus Software",
    "https://www.kalzumeus.com/feed/articles/",
    "https://www.kalzumeus.com/",
    {
      description:
        "Patrick McKenzie (patio11) blogs on software development, marketing, and general business topics",
    },
  ),
  blog(
    "Krebs on Security",
    "https://krebsonsecurity.com/feed/",
    "https://krebsonsecurity.com/",
    { description: "In-depth security news and investigation" },
  ),
  blog(
    "Ludicity",
    "https://ludic.mataroa.blog/rss/",
    "https://ludic.mataroa.blog/",
    { description: LUDICITY_DESCRIPTION },
  ),
  blog(
    "Mitchell Hashimoto",
    "https://mitchellh.com/feed.xml",
    "https://mitchellh.com/",
    { description: "Mitchell Hashimoto's personal blog" },
  ),
  blog("OlegWock blog", "https://sinja.io/rss", "https://sinja.io/", {
    description: "OlegWock blog",
  }),
  blog(
    "Peter Norvig",
    "https://www.norvig.com/rss-feed.xml",
    "http://www.norvig.com/",
    { description: "Articles by Peter Norvig" },
  ),
  blog("samwho.dev", "https://samwho.dev/rss.xml", "https://samwho.dev/", {
    description: "Personal website of Sam Rose.",
  }),
  blog(
    "seangoedecke.com RSS feed",
    "https://www.seangoedecke.com/rss.xml",
    "https://seangoedecke.com/",
    { description: "Sean Goedecke's personal blog" },
  ),
  blog(
    "Simon Willison's Weblog: Entries",
    "https://simonwillison.net/atom/entries/",
    "http://simonwillison.net/",
  ),
  blog(
    "Useful Fictions",
    "https://usefulfictions.substack.com/feed",
    "https://usefulfictions.substack.com/",
    { description: "all models are wrong, but some are useful" },
  ),
  blog(
    "Visual Studio Code - Code Editing. Redefined.",
    "https://code.visualstudio.com/feed.xml",
    "https://code.visualstudio.com/",
    { hidden: true },
  ),
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
  if (rule.pattern.length === 0) {
    throw new Error(`Empty autoRead pattern on catalog feed "${feedTitle}"`);
  }
  try {
    new RegExp(rule.pattern, rule.flags).test("");
  } catch (error: unknown) {
    throw new Error(
      `Invalid autoRead regex on catalog feed "${feedTitle}": ${String(error)}`,
      { cause: error },
    );
  }
}

export function validateCatalog(feeds: readonly DeclaredFeed[]): void {
  let repoStackCount = 0;
  let blogsCount = 0;
  const seenUrls = new Set<string>();

  for (const feed of feeds) {
    if (feed.title.trim().length === 0) {
      throw new Error(`Catalog feed title cannot be empty (${feed.url})`);
    }
    if (feed.category === "Repo Stack") {
      repoStackCount += 1;
    } else {
      blogsCount += 1;
    }

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

  if (repoStackCount === 0) {
    throw new Error('Catalog must declare at least one "Repo Stack" feed');
  }
  if (blogsCount === 0) {
    throw new Error('Catalog must declare at least one "Blogs" feed');
  }
}
