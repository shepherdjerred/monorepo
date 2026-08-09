import { describe, expect, test } from "bun:test";
import path from "node:path";
import { REPORT_METRICS } from "@scout-for-lol/data/model/report-query-metrics.ts";
import {
  REPORT_RENDER_KINDS,
  REPORT_SOURCES,
} from "@scout-for-lol/data/model/report-query-registry.ts";
import { ALL_PERMISSIONS } from "@scout-for-lol/data/model/permissions/catalog.ts";

/**
 * These assertions run against the built site (`bun run build` precedes
 * `bun test`), because the things worth protecting here only exist after a
 * build: the resolved link graph, the `base` prefix applied to sidebar links,
 * and the reference tables rendered from `@scout-for-lol/data`.
 */

const DIST = new URL("../dist", import.meta.url).pathname;
const BASE = "/docs/";

const htmlRelativePaths = [
  ...new Bun.Glob("**/*.html").scanSync({ cwd: DIST, onlyFiles: true }),
].sort();

if (htmlRelativePaths.length === 0) {
  throw new Error(
    `No built pages found in ${DIST}. Run \`bun run build\` first, or run the suite through turbo (\`bunx turbo run test --filter=@scout-for-lol/docs-site\`), which builds it for you.`,
  );
}

const htmlByPath = new Map<string, string>(
  await Promise.all(
    htmlRelativePaths.map(
      async (rel): Promise<[string, string]> => [
        rel,
        await Bun.file(path.join(DIST, rel)).text(),
      ],
    ),
  ),
);

const pages = new Set<string>(
  htmlRelativePaths
    .filter((rel) => rel.endsWith("index.html"))
    .map((rel) =>
      rel === "index.html" ? BASE : `${BASE}${rel.replace(/index\.html$/, "")}`,
    ),
);

/**
 * Anchor targets only. `<link rel="canonical">` and Open Graph URLs are
 * absolute against the stage origin by design (`PUBLIC_DOCS_SITE_ORIGIN`), so
 * matching every `href=` would flag them as hard-coded production links.
 */
function anchorHrefs(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
}

const distFiles = new Set<string>(
  new Bun.Glob("**/*").scanSync({ cwd: DIST, onlyFiles: true }),
);

function resolves(href: string): boolean {
  return pages.has(href) || distFiles.has(href.slice(BASE.length));
}

function page(route: string): string {
  const html = htmlByPath.get(path.join(route, "index.html"));
  if (html === undefined) {
    throw new Error(`${route} was not built`);
  }
  return html;
}

describe("built pages", () => {
  test("every documentation section produced pages", () => {
    for (const section of ["tutorials", "how-to", "reference", "explanation"]) {
      const sectionPages = [...pages].filter((entry) =>
        entry.startsWith(`${BASE}${section}/`),
      );
      expect(sectionPages.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("the site has at least 15 content pages", () => {
    expect(
      [...pages].filter((entry) => entry !== BASE).length,
    ).toBeGreaterThanOrEqual(15);
  });
});

describe("internal links", () => {
  test("every internal link resolves to a built page or asset", () => {
    const broken: string[] = [];
    for (const [rel, html] of htmlByPath) {
      for (const href of anchorHrefs(html)) {
        if (!href.startsWith(BASE)) {
          continue;
        }
        const clean = href.split(/[#?]/)[0] ?? "";
        if (!resolves(clean)) {
          broken.push(`${rel} -> ${href}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("no link double-prefixes the base path", () => {
    // Starlight runs sidebar `link` values through pathWithBase(), so writing
    // "/docs/..." in astro.config.ts silently produces "/docs/docs/...".
    const doubled: string[] = [];
    for (const [rel, html] of htmlByPath) {
      for (const href of anchorHrefs(html)) {
        if (href.startsWith(`${BASE}docs/`)) {
          doubled.push(`${rel} -> ${href}`);
        }
      }
    }
    expect(doubled).toEqual([]);
  });

  test("dashboard links are origin-relative so they work on beta", () => {
    // A hard-coded https://scout-for-lol.com/app/ link sends beta readers to
    // production. Only the dashboard reference may name the origins.
    const offenders: string[] = [];
    for (const [rel, html] of htmlByPath) {
      if (rel.startsWith("reference/dashboard/")) {
        continue;
      }
      for (const href of anchorHrefs(html)) {
        if (href.startsWith("https://scout-for-lol.com/")) {
          offenders.push(`${rel} -> ${href}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

const renderSampleManifest: {
  kind: string;
  query: string;
  image: string | null;
  content: string | null;
}[] = JSON.parse(
  await Bun.file(
    new URL("assets/generated/render-samples.json", import.meta.url).pathname,
  ).text(),
);

describe("generated render samples", () => {
  test("every render kind in the registry has a generated sample", () => {
    const covered = new Set(renderSampleManifest.map((entry) => entry.kind));
    expect(
      REPORT_RENDER_KINDS.filter((kind) => !covered.has(kind.id)).map(
        (kind) => kind.id,
      ),
    ).toEqual([]);
  });

  test("chart kinds produce an image and text kinds produce message content", () => {
    const wrong: string[] = [];
    for (const kind of REPORT_RENDER_KINDS) {
      const entry = renderSampleManifest.find((item) => item.kind === kind.id);
      if (entry === undefined) {
        continue;
      }
      const hasImage = entry.image !== null;
      if (hasImage !== kind.isChart) {
        wrong.push(
          `${kind.id}: isChart=${String(kind.isChart)} but image=${String(hasImage)}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  test("every sample referenced by the manifest was rendered into the build", () => {
    const missing = renderSampleManifest
      .filter((entry) => entry.image !== null)
      .map((entry) => entry.image ?? "")
      // Astro fingerprints and converts to webp, so match on the stem.
      .filter(
        (image) =>
          ![...distFiles].some((file) =>
            file.startsWith(`_astro/${image.replace(/\.png$/, "")}`),
          ),
      );
    expect(missing).toEqual([]);
  });

  test("the competition leaderboard image is generated, not hand-picked", () => {
    const built = [...distFiles].some((file) =>
      file.startsWith("_astro/competition-leaderboard"),
    );
    expect(built).toBe(true);
  });
});

describe("cross-package facts the prose depends on", () => {
  test("the competition chart's value-axis label still matches the backend", async () => {
    // The generator hard-codes "Games" for MOST_GAMES_PLAYED because
    // valueAxisLabelForCriteria is not exported (its module pulls in runtime
    // config). If that mapping is renamed, this fails instead of the docs
    // quietly showing a stale axis label.
    const source = await Bun.file(
      new URL(
        "../../backend/src/league/competition/chart-builder.ts",
        import.meta.url,
      ).pathname,
    ).text();
    expect(source).toContain(
      '.with({ type: "MOST_GAMES_PLAYED" }, () => "Games")',
    );
  });

  test("docs URLs referenced from Scout source resolve to real pages", async () => {
    // The outreach DMs and Discord replies link into /docs/ from outside this
    // package, so renaming a page here can 404 a link the docs tests never see.
    const scoutRoot = new URL("../../..", import.meta.url).pathname;
    const sources = [
      ...new Bun.Glob(
        "packages/{backend,app,frontend}/src/**/*.{ts,tsx,astro}",
      ).scanSync({ cwd: scoutRoot, onlyFiles: true }),
    ];
    const broken: string[] = [];
    for (const rel of sources) {
      const text = await Bun.file(path.join(scoutRoot, rel)).text();
      for (const match of text.matchAll(
        /https:\/\/(?:beta\.)?scout-for-lol\.com(\/docs\/[^"'`\s)]*)/g,
      )) {
        const route = match[1] ?? "";
        if (!pages.has(route) && !distFiles.has(route.slice(BASE.length))) {
          broken.push(`${rel} -> ${route}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("documented dashboard sections still match the app's nav", async () => {
    // The dashboard reference and every dashboard screenshot assume this exact
    // set of tabs. A rename here (the old marketing shots said "Admin") should
    // fail loudly rather than leave the docs quietly wrong.
    const source = await Bun.file(
      new URL("../../app/src/routes/guild-workspace.tsx", import.meta.url)
        .pathname,
    ).text();
    const labels = [...source.matchAll(/label:\s*"([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(labels).toEqual([
      "Subscriptions",
      "Players",
      "Competitions",
      "Reports",
      "Audit",
      "Access",
    ]);
  });

  test("documented cron intervals still match the backend scheduler", async () => {
    const source = await Bun.file(
      new URL("../../backend/src/league/cron.ts", import.meta.url).pathname,
    ).text();
    // Each entry is (documented claim → the schedule expression that backs it).
    const claims: [string, string][] = [
      ["pre-match every 30 seconds", "*/30 * * * * *"],
      ["post-match every minute", "0 * * * * *"],
      ["competition lifecycle every 15 minutes", "0 */15 * * * *"],
      ["report lake fold every 15 minutes", "0 5-59/15 * * * *"],
      ["report lake rebuild daily at 02:00 UTC", "0 0 2 * * *"],
      ["player pruning daily at 03:00 UTC", "0 0 3 * * *"],
      ["removed-guild cleanup daily at 04:00 UTC", "0 0 4 * * *"],
      ["match-time refresh every 6 hours", "0 0 */6 * * *"],
    ];
    const stale = claims
      .filter(([, schedule]) => !source.includes(`"${schedule}"`))
      .map(([claim]) => claim);
    expect(stale).toEqual([]);
  });
});

describe("generated reference tables", () => {
  test("every metric in the registry is documented", () => {
    const html = page("reference/scoutql-metrics");
    expect(
      REPORT_METRICS.filter((metric) => !html.includes(metric.id)).map(
        (metric) => metric.id,
      ),
    ).toEqual([]);
  });

  test("every render kind in the registry is documented", () => {
    const html = page("reference/scoutql-render");
    expect(
      REPORT_RENDER_KINDS.filter((kind) => !html.includes(kind.id)).map(
        (kind) => kind.id,
      ),
    ).toEqual([]);
  });

  test("every query source in the registry is documented", () => {
    const html = page("reference/scoutql-sources");
    expect(
      REPORT_SOURCES.filter((source) => !html.includes(source.id)).map(
        (source) => source.id,
      ),
    ).toEqual([]);
  });

  test("every permission in the catalog is documented", () => {
    const html = page("reference/permissions");
    expect(
      ALL_PERMISSIONS.filter(
        (permission) =>
          !html.includes(`${permission.resource}:${permission.action}`),
      ).map((permission) => `${permission.resource}:${permission.action}`),
    ).toEqual([]);
  });
});
