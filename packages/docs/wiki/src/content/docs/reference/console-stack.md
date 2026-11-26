---
title: Console stack reference
description: The one library stack of the ten first-party ops consoles, its Rust and fixed-protocol exceptions, the shared Bun catalog, and the check that holds each console to it.
---

The ten first-party ops consoles share one stack: Hub, Delivery, Tracker,
Errors, Mail, Flags, Feeds, Go link, Charts and CI cache. The shared look is
[`@shepherdjerred/console-ui`](/reference/console-ui/); this page lists the
libraries underneath it. [Why the consoles share one stack](/explanation/homelab/hosted-service-model/#one-stack-for-the-consoles)
gives the reasoning.

## The standard

| Layer                 | Standard                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Router                | TanStack Router with code-based routes; every URL parameter is validated with Zod        |
| Browser data          | tRPC with TanStack Query through `@trpc/tanstack-react-query`                            |
| First-party callers   | Typed tRPC clients for the toolkit, Temporal, CI lanes and other services                |
| Server                | Hono on Bun, started through the shared server kit                                       |
| Database              | Prisma on PostgreSQL                                                                     |
| Headless UI           | Base UI (`@base-ui/react`), through console-ui                                           |
| Tables                | TanStack Table, inside console-ui's `DataTable`                                          |
| Forms                 | TanStack Form with Zod                                                                   |
| Long lists            | TanStack Virtual                                                                         |
| Charts                | uPlot                                                                                    |
| Drag and drop         | dnd-kit                                                                                  |
| Markdown              | react-markdown with remark-gfm                                                           |
| Code editor           | Monaco                                                                                   |
| Dates                 | Temporal (`@js-temporal/polyfill`) for date math, `Intl` for display                     |
| Icons                 | lucide-react                                                                             |
| Class names           | clsx, in console-ui only                                                                 |
| Validation            | Zod 4                                                                                    |
| Browser tests         | Vitest browser mode with axe for new tests; Playwright with axe stays for full-app flows |
| Framework and tooling | React 19.3.1, Vite 8, TypeScript 6, Vitest 5                                             |

## Exceptions

| Exception              | Applies to                                                                                                                                                                                 | What changes                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Rust server            | Charts, CI cache                                                                                                                                                                           | The server cannot serve tRPC or use Prisma. The client uses TanStack Query over REST with Zod. `rusqlite` stays |
| Fixed outside protocol | Sentry envelope ingest, SMTP, the Google Reader API, the Alertmanager webhook, the Helm repository, the Turborepo, Gradle and sccache caches, Go link redirects, health probes, `/metrics` | The endpoint keeps its REST or wire format; everything around it is tRPC                                        |
| File upload            | Tracker attachments                                                                                                                                                                        | Plain HTTP                                                                                                      |

## Banned alternatives

The check fails when a console declares one of these, unless the console's
allowlist entry names it.

| Replaced by              | Banned                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Router          | `react-router`, `react-router-dom`, `@remix-run/router`, `wouter`, `@reach/router`, `navigo`                                                |
| tRPC with TanStack Query | `swr`, `axios`, `ky`, `ofetch`, `got`, `node-fetch`, `superagent`                                                                           |
| uPlot                    | `recharts`, `echarts`, `echarts-for-react`, `chart.js`, `react-chartjs-2`, `d3`, `victory`, `apexcharts`, `plotly.js`, `@visx/*`, `@nivo/*` |
| Temporal and `Intl`      | `date-fns`, `dayjs`, `luxon`, `moment`, `moment-timezone`, `@date-fns/*`                                                                    |
| TanStack Form            | `react-hook-form`, `formik`, `final-form`, `react-final-form`                                                                               |
| Base UI                  | `@radix-ui/*`, `radix-ui`, `@headlessui/react`, `react-aria`, `react-aria-components`, `@react-aria/*`, `ariakit`, `@ariakit/*`             |
| TanStack Virtual         | `react-window`, `react-virtualized`, `react-virtuoso`                                                                                       |
| dnd-kit                  | `react-dnd`, `react-beautiful-dnd`, `@hello-pangea/dnd`                                                                                     |
| react-markdown           | `marked`, `markdown-it`, `showdown`, `snarkdown`                                                                                            |
| Plain CSS on console-ui  | `tailwindcss`, `@tailwindcss/*`, `styled-components`, `@emotion/*`, `goober`                                                                |
| Hono on Bun              | `express`, `fastify`, `koa`, `@hapi/hapi`                                                                                                   |
| Prisma on PostgreSQL     | `better-sqlite3`, `sqlite3`, `@libsql/client`, `@prisma/adapter-libsql`, `@prisma/adapter-better-sqlite3`                                   |

A Rust console's client also may not declare `hono`, `@hono/bun`,
`@trpc/server` or `prisma`.

## Required libraries

| Package kind        | Required                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript console  | The toolchain, `@tanstack/react-query`, `@tanstack/react-router`, `@trpc/client`, `@trpc/server`, `@trpc/tanstack-react-query`, `hono`, `@hono/bun`, `prisma`, `@prisma/client`, `@prisma/adapter-pg` |
| Rust console client | The toolchain, `@tanstack/react-query`, `@tanstack/react-router`                                                                                                                                      |
| `console-ui`        | `@base-ui/react`, `clsx`, `lucide-react`, `@tanstack/react-table`, `@tanstack/react-form`                                                                                                             |

A console that depends on `@shepherdjerred/console-server` counts as declaring
`hono`, `@hono/bun`, `@trpc/server` and `@trpc/client`. One that depends on
`@shepherdjerred/console-client` counts as declaring `@tanstack/react-query`,
`@tanstack/react-router` and the tRPC client libraries.

The toolchain is `react`, `react-dom`, `@types/react`, `@types/react-dom`,
`@vitejs/plugin-react`, `typescript`, `vite`, `vitest`, `zod` and
`lucide-react`.

## The Bun catalog

The root `package.json` declares a default `catalog` that holds one version of
every library in the standard. A console, `console-ui` and `ops-model` declare
those libraries as `"catalog:"`. Change a version in the catalog and run
`bun install`, which rewrites `bun.lock`. A catalogued library declared with its
own version fails the stack check.

Three kinds of library are outside the catalog:

| Library                                         | Why                                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@playwright/test`                              | The `ci-playwright` image promotion rewrites each exact pin together with the image digest                                                                       |
| `@types/bun`                                    | Pinned with the Bun toolchain, which moves in one change                                                                                                         |
| `@tanstack/react-table`, `@tanstack/react-form` | Knip rejects a catalog entry no package uses. The change that first declares one adds it to the catalog and removes it from `CATALOG_PENDING` in the stack rules |

Renovate does not read `catalog` in a root `package.json` natively, so a
JSONata custom manager in `renovate.json` extracts every entry. Mend-hosted
Renovate cannot run `bun install`, so a catalog bump leaves `bun.lock` stale
until someone refreshes it on the branch.

## The stack check

`bun run check-console-stack` runs
`scripts/checks/check-console-stack.ts`
against each console's `package.json` and the root catalog, and prints one row
per deviation. The rules and the allowlist live in
`scripts/checks/console-stack-rules.ts`.

| Deviation      | Meaning                                                        |
| -------------- | -------------------------------------------------------------- |
| `missing`      | The standard requires a library the package does not declare   |
| `banned`       | The package declares an alternative the standard replaces      |
| `uncatalogued` | The package declares a catalogued library with its own version |

Every deviation that exists today has an allowlist entry with a reason. The
allowlist only shrinks:

- A deviation with no entry fails the check.
- An entry whose deviation no longer exists fails the check, so the change that
  removes a deviation removes its entry in the same pull request.
- An entry names a package in the console list and carries a non-empty reason.

The service scaffolder writes the standard stack for a new console:
`bun scripts/misc/new-service.ts --kind web --console`. See
[Add a hosted service](/how-to/add-a-hosted-service/).

## Related

- [Console UI reference](/reference/console-ui/)
- [Why the consoles share one stack](/explanation/homelab/hosted-service-model/#one-stack-for-the-consoles)
- [Add a hosted service](/how-to/add-a-hosted-service/)
