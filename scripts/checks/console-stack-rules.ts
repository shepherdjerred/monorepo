/**
 * The console stack standard as data: which packages are consoles, what each
 * kind requires, what is banned, and today's allowlisted deviations. The rules
 * are enforced by `check-console-stack.ts` and written up in
 * `packages/docs/wiki/src/content/docs/reference/console-stack.md`.
 */

export type ConsoleKind = "typescript" | "rust-client" | "shared-ui";

export type ConsoleDefinition = {
  /** Short id used in the allowlist and the report. */
  readonly id: string;
  readonly label: string;
  /** Directory holding the `package.json`, relative to the repository root. */
  readonly directory: string;
  readonly kind: ConsoleKind;
};

export const CONSOLES: readonly ConsoleDefinition[] = [
  {
    id: "hub",
    label: "Hub",
    directory: "packages/alert-dashboard",
    kind: "typescript",
  },
  {
    id: "delivery",
    label: "Delivery",
    directory: "packages/delivery",
    kind: "typescript",
  },
  {
    id: "tracker",
    label: "Tracker",
    directory: "packages/tracker",
    kind: "typescript",
  },
  {
    id: "errors",
    label: "Errors",
    directory: "packages/errors",
    kind: "typescript",
  },
  { id: "mail", label: "Mail", directory: "packages/mail", kind: "typescript" },
  {
    id: "flags",
    label: "Flags",
    directory: "packages/flags",
    kind: "typescript",
  },
  {
    id: "feeds",
    label: "Feeds",
    directory: "packages/feeds",
    kind: "typescript",
  },
  {
    id: "golink",
    label: "Go link",
    directory: "packages/golink",
    kind: "typescript",
  },
  {
    id: "charts",
    label: "Charts",
    directory: "packages/charts",
    kind: "rust-client",
  },
  {
    id: "ci-cache",
    label: "CI cache",
    directory: "packages/ci-cache",
    kind: "rust-client",
  },
  {
    id: "console-ui",
    label: "console-ui",
    directory: "packages/console-ui",
    kind: "shared-ui",
  },
];

/** What every console builds and tests with. */
const TOOLCHAIN = [
  "react",
  "react-dom",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react",
  "typescript",
  "vite",
  "vitest",
  "zod",
  "lucide-react",
] as const;

/** Router and browser data: TanStack Router, tRPC with TanStack Query. */
const BROWSER_STACK = ["@tanstack/react-query", "@tanstack/react-router"];

/** tRPC, Hono on Bun and Prisma on PostgreSQL: the TypeScript server stack. */
const SERVER_STACK = [
  "@trpc/client",
  "@trpc/server",
  "@trpc/tanstack-react-query",
  "hono",
  "@hono/bun",
  "prisma",
  "@prisma/client",
  "@prisma/adapter-pg",
];

/** The shared pieces console-ui owns for every console. */
const SHARED_UI = [
  "react",
  "react-dom",
  "@types/react",
  "@types/react-dom",
  "typescript",
  "vitest",
  "lucide-react",
  "@base-ui/react",
  "clsx",
  "@tanstack/react-table",
  "@tanstack/react-form",
];

export const REQUIRED: Readonly<Record<ConsoleKind, readonly string[]>> = {
  typescript: [...TOOLCHAIN, ...BROWSER_STACK, ...SERVER_STACK],
  // Rust servers cannot serve tRPC or use Prisma: their clients use TanStack
  // Query over REST with Zod, and the servers keep rusqlite.
  "rust-client": [...TOOLCHAIN, ...BROWSER_STACK],
  "shared-ui": SHARED_UI,
};

/**
 * Shared kits that carry part of the stack for their consumers. A console that
 * depends on a kit counts as declaring the libraries the kit provides.
 */
export const KIT_PROVIDES: Readonly<Record<string, readonly string[]>> = {
  "@shepherdjerred/console-server": [
    "hono",
    "@hono/bun",
    "@trpc/server",
    "@trpc/client",
  ],
  "@shepherdjerred/console-client": [
    "@tanstack/react-query",
    "@tanstack/react-router",
    "@trpc/client",
    "@trpc/server",
    "@trpc/tanstack-react-query",
  ],
};

/**
 * Required libraries not in the root catalog yet. Knip rejects a catalog entry
 * that no package uses, so the change that first declares one adds it to the
 * catalog and deletes it here.
 */
export const CATALOG_PENDING: readonly string[] = [
  "@tanstack/react-form",
  "@tanstack/react-table",
];

/**
 * Libraries a Rust console's client must not carry: the server stack cannot
 * run against a Rust server.
 */
export const RUST_BANNED = ["hono", "@hono/bun", "@trpc/server", "prisma"];

/**
 * Alternatives the standard replaces. An entry ending in `/` bans the whole
 * scope or prefix.
 */
export const BANNED_GROUPS: readonly {
  replaces: string;
  names: readonly string[];
}[] = [
  {
    replaces: "TanStack Router",
    names: [
      "react-router",
      "react-router-dom",
      "@remix-run/router",
      "wouter",
      "@reach/router",
      "navigo",
    ],
  },
  {
    replaces: "tRPC with TanStack Query",
    names: ["swr", "axios", "ky", "ofetch", "got", "node-fetch", "superagent"],
  },
  {
    replaces: "uPlot",
    names: [
      "recharts",
      "echarts",
      "echarts-for-react",
      "chart.js",
      "react-chartjs-2",
      "d3",
      "victory",
      "apexcharts",
      "plotly.js",
      "@visx/",
      "@nivo/",
    ],
  },
  {
    replaces: "Temporal (@js-temporal/polyfill) and Intl",
    names: [
      "date-fns",
      "dayjs",
      "luxon",
      "moment",
      "moment-timezone",
      "@date-fns/",
    ],
  },
  {
    replaces: "TanStack Form",
    names: ["react-hook-form", "formik", "final-form", "react-final-form"],
  },
  {
    replaces: "Base UI",
    names: [
      "@radix-ui/",
      "radix-ui",
      "@headlessui/react",
      "react-aria",
      "react-aria-components",
      "@react-aria/",
      "ariakit",
      "@ariakit/",
    ],
  },
  {
    replaces: "TanStack Virtual",
    names: ["react-window", "react-virtualized", "react-virtuoso"],
  },
  {
    replaces: "dnd-kit",
    names: ["react-dnd", "react-beautiful-dnd", "@hello-pangea/dnd"],
  },
  {
    replaces: "react-markdown with remark-gfm",
    names: ["marked", "markdown-it", "showdown", "snarkdown"],
  },
  {
    replaces: "plain CSS on console-ui",
    names: [
      "tailwindcss",
      "@tailwindcss/",
      "styled-components",
      "@emotion/",
      "goober",
    ],
  },
  {
    replaces: "Hono on Bun",
    names: ["express", "fastify", "koa", "@hapi/hapi"],
  },
  {
    replaces: "Prisma on PostgreSQL",
    names: [
      "better-sqlite3",
      "sqlite3",
      "@libsql/client",
      "@prisma/adapter-libsql",
      "@prisma/adapter-better-sqlite3",
    ],
  },
];

export type Deviation = {
  readonly app: string;
  /** `missing`, `banned` or `uncatalogued`. */
  readonly kind: "missing" | "banned" | "uncatalogued";
  readonly library: string;
  /** The rule the deviation breaks, for the report. */
  readonly rule: string;
};

export type AllowlistEntry = {
  readonly app: string;
  readonly kind: Deviation["kind"];
  readonly library: string;
  /** Why the deviation exists today and which change removes it. */
  readonly reason: string;
};

const TRPC = ["@trpc/client", "@trpc/server", "@trpc/tanstack-react-query"];
const PRISMA = ["prisma", "@prisma/client", "@prisma/adapter-pg"];

const ROUTER = "TanStack Router lands with the app's router PR";
const API = "browser and callers use REST until the app's tRPC API PR";
const DATABASE = "raw SQLite until the app's PostgreSQL and Prisma PR";
const SHARED_UI_PIECES =
  "console-ui gains it with the shared DataTable and form pieces";

function entries(
  app: string,
  kind: AllowlistEntry["kind"],
  libraries: readonly string[],
  reason: string,
): AllowlistEntry[] {
  return libraries.map((library) => ({ app, kind, library, reason }));
}

/**
 * Today's deviations, exactly. Migration PRs delete entries; nothing adds one
 * without changing this file in review.
 */
export const ALLOWLIST: readonly AllowlistEntry[] = [
  // Hub: React Router 8 and Prisma on SQLite; tRPC and Hono are already in.
  ...entries("hub", "banned", ["react-router"], "react-router until Hub-R"),
  ...entries("hub", "missing", ["@tanstack/react-router"], ROUTER),
  ...entries(
    "hub",
    "banned",
    ["@prisma/adapter-libsql"],
    "Prisma on SQLite until Hub's PostgreSQL move",
  ),
  ...entries(
    "hub",
    "missing",
    ["@prisma/adapter-pg"],
    "Prisma on SQLite until Hub's PostgreSQL move",
  ),
  // Delivery: TanStack Router and Prisma on PostgreSQL are in; 125 REST routes remain.
  ...entries(
    "delivery",
    "missing",
    TRPC,
    "125 REST routes until Delivery's tRPC API PR",
  ),
  // Tracker: React Router 8, and a plain tRPC client without TanStack Query's integration.
  ...entries(
    "tracker",
    "banned",
    ["react-router"],
    "react-router until Tracker-R",
  ),
  ...entries("tracker", "missing", ["@tanstack/react-router"], ROUTER),
  ...entries(
    "tracker",
    "missing",
    ["@trpc/tanstack-react-query"],
    "plain tRPC client until Tracker moves to the TanStack Query integration",
  ),
  // Errors: React Router 8, REST for the browser, static files served by hand.
  ...entries(
    "errors",
    "banned",
    ["react-router"],
    "react-router until Errors-R",
  ),
  ...entries("errors", "missing", ["@tanstack/react-router"], ROUTER),
  ...entries("errors", "missing", TRPC, API),
  ...entries(
    "errors",
    "missing",
    ["@hono/bun"],
    "static files served by hand until the shared server kit",
  ),
  // Mail: React Router 8, REST, raw SQLite.
  ...entries("mail", "banned", ["react-router"], "react-router until Mail-R"),
  ...entries("mail", "missing", ["@tanstack/react-router"], ROUTER),
  ...entries("mail", "missing", TRPC, API),
  ...entries("mail", "missing", PRISMA, DATABASE),
  // Flags: React Router 8, REST, raw SQLite.
  ...entries("flags", "banned", ["react-router"], "react-router until Flags-R"),
  ...entries("flags", "missing", ["@tanstack/react-router"], ROUTER),
  ...entries("flags", "missing", TRPC, API),
  ...entries("flags", "missing", PRISMA, DATABASE),
  // Feeds: a hand-rolled router, REST, raw SQLite.
  ...entries(
    "feeds",
    "missing",
    ["@tanstack/react-router"],
    "hand-rolled router until Feeds' router PR",
  ),
  ...entries("feeds", "missing", TRPC, API),
  ...entries("feeds", "missing", PRISMA, DATABASE),
  // Go link is on the shared server and client kits: nothing left to allowlist.
  // Rust consoles: single pages reading the URL by hand, no TanStack Query yet.
  ...entries(
    "charts",
    "missing",
    ["@tanstack/react-router", "@tanstack/react-query"],
    "single page reading the URL by hand until Charts' client PR",
  ),
  ...entries(
    "ci-cache",
    "missing",
    ["@tanstack/react-router", "@tanstack/react-query"],
    "single page reading the URL by hand until CI cache's client PR",
  ),
  // console-ui: the shared DataTable and form pieces are not written yet.
  ...entries(
    "console-ui",
    "missing",
    ["@tanstack/react-table", "@tanstack/react-form"],
    SHARED_UI_PIECES,
  ),
];
