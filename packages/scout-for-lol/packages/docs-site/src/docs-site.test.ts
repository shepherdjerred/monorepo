import { describe, expect, test } from "vitest";
import path from "node:path";
import { SCOUTQL_RENDER_KINDS } from "@scout-for-lol/data/model/scoutql/catalog-render-kinds.ts";
import { scoutQlSourceCatalogs } from "@scout-for-lol/data/model/scoutql/catalog-columns.ts";
import { SCOUTQL_FUNCTIONS } from "@scout-for-lol/data/model/scoutql/catalog-functions.ts";
import { SCOUTQL_CHART_OPTION_NAMES } from "@scout-for-lol/data/model/scoutql/render-options.ts";
import { SCOUTQL_IDIOMS } from "@scout-for-lol/data/model/scoutql/scoutql-idioms.ts";
import { ALL_PERMISSIONS } from "@scout-for-lol/data/model/permissions/catalog.ts";

/**
 * These assertions run against the built site (`bun run build` precedes
 * `bun run test`), because the things worth protecting here only exist after a
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
    htmlRelativePaths.map(async (rel): Promise<[string, string]> => [
      rel,
      await Bun.file(path.join(DIST, rel)).text(),
    ]),
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

/**
 * Astro escapes text nodes, so a signature containing an apostrophe reaches
 * the page as `player(&#39;name&#39;)`. Comparing decoded text keeps these
 * assertions written the way the catalogs write them.
 */
function decode(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x3C;", "<")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Whether a value is rendered as its own `<code>` cell, not merely mentioned. */
function hasCodeCell(html: string, value: string): boolean {
  return decode(html).includes(`<code>${value}</code>`);
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
  test("the committed samples match a fresh render", async () => {
    // `build` depends on `generate`, so by the time this suite runs the assets
    // have just been re-derived from the current renderer. Anything committed
    // that no longer matches shows up as a dirty worktree. This is the drift
    // gate: the release path calls `astro build` directly and would otherwise
    // happily ship stale PNGs.
    const status = await new Response(
      Bun.spawn(
        ["git", "status", "--porcelain", "--", "src/assets/generated"],
        { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe" },
      ).stdout,
    ).text();
    expect(status.trim()).toBe("");
  });

  test("every render kind in the catalog has a generated sample", () => {
    const covered = new Set(renderSampleManifest.map((entry) => entry.kind));
    expect(
      SCOUTQL_RENDER_KINDS.filter((kind) => !covered.has(kind.id)).map(
        (kind) => kind.id,
      ),
    ).toEqual([]);
  });

  test("no sample is declared for a render kind that does not exist", () => {
    const known = new Set(SCOUTQL_RENDER_KINDS.map((kind) => kind.id));
    expect(
      renderSampleManifest
        .map((entry) => entry.kind)
        .filter((kind) => !known.has(kind)),
    ).toEqual([]);
  });

  test("chart kinds produce an image and text kinds produce message content", () => {
    const wrong: string[] = [];
    for (const kind of SCOUTQL_RENDER_KINDS) {
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

  test("the documented query limits still match the analyzer", async () => {
    // Three of the limits on the ScoutQL page are private constants in the
    // analyzer rather than exported values the page could read, so the page
    // states them by hand. This is what stops the hand-written copy drifting.
    const scoutql = new URL("../../data/src/model/scoutql/", import.meta.url)
      .pathname;
    const claims: [string, string, string][] = [
      ["1\u{2013}20 outputs", "analyze-select.ts", "const MAX_OUTPUTS = 20;"],
      [
        "1\u{2013}3 order keys",
        "analyze-order.ts",
        "const MAX_ORDER_KEYS = 3;",
      ],
      [
        "0\u{2013}3 groupings",
        "analyze-group.ts",
        "A query may group by at most 3 dimensions",
      ],
    ];
    const stale: string[] = [];
    for (const [claim, file, snippet] of claims) {
      const source = await Bun.file(path.join(scoutql, file)).text();
      if (!source.includes(snippet)) {
        stale.push(claim);
      }
    }
    expect(stale).toEqual([]);
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
  test("every source and every one of its columns is documented", () => {
    // The metric enum is gone: a source's columns ARE the SELECT vocabulary,
    // so this page is the only place a reader can look one up. A column added
    // to the lake and left off it is invisible.
    const html = page("reference/scoutql-sources");
    const missing: string[] = [];
    for (const catalog of scoutQlSourceCatalogs()) {
      if (!hasCodeCell(html, catalog.id)) {
        missing.push(catalog.id);
      }
      for (const column of catalog.columns.values()) {
        if (!hasCodeCell(html, column.name)) {
          missing.push(`${catalog.id}.${column.name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("every source states its time column, or that it has none", () => {
    const html = decode(page("reference/scoutql-sources"));
    const missing = scoutQlSourceCatalogs()
      .filter(
        (catalog) =>
          !html.includes(`<code>${catalog.timeColumn ?? "none"}</code>`),
      )
      .map((catalog) => catalog.id);
    expect(missing).toEqual([]);
  });

  test("every function in the catalog is documented with its signature", () => {
    const html = decode(page("reference/scoutql-functions"));
    const missing = SCOUTQL_FUNCTIONS.flatMap((fn) =>
      fn.signatures
        .filter(
          (signature) => !html.includes(`<code>${signature.label}</code>`),
        )
        .map((signature) => `${fn.name}: ${signature.label}`),
    );
    expect(missing).toEqual([]);
  });

  test("every render kind in the catalog is documented", () => {
    const html = page("reference/scoutql-render");
    expect(
      SCOUTQL_RENDER_KINDS.filter((kind) => !hasCodeCell(html, kind.id)).map(
        (kind) => kind.id,
      ),
    ).toEqual([]);
  });

  test("every render option the language accepts is documented", () => {
    const html = page("reference/scoutql-render");
    expect(
      SCOUTQL_CHART_OPTION_NAMES.filter((name) => !hasCodeCell(html, name)),
    ).toEqual([]);
  });

  test("every idiom is on the recipes page", () => {
    const html = decode(page("how-to/scoutql-recipes"));
    const missing = SCOUTQL_IDIOMS.filter(
      (idiom) =>
        !html.includes(`id="${idiom.id}"`) || !html.includes(idiom.title),
    ).map((idiom) => idiom.id);
    expect(missing).toEqual([]);
  });

  test("the retired metrics URL still resolves to the functions page", () => {
    // The old path is in Discord messages, bookmarks, and the design-audit
    // route list; it redirects rather than 404ing.
    const html = htmlByPath.get(
      path.join("reference/scoutql-metrics", "index.html"),
    );
    expect(html).toBeDefined();
    expect(html ?? "").toContain("/docs/reference/scoutql-functions/");
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
