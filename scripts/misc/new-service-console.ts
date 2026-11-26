import type { ServiceOptions } from "./new-service-options.ts";

/**
 * The opt-in `--console` template of `new-service.ts`: a web service on the
 * stack standard for first-party ops consoles, written up in the wiki
 * reference "Console stack" and enforced by `scripts/checks/check-console-stack.ts`.
 *
 * A Hono server on Bun with `/healthz`, a tRPC router, a Prisma schema for
 * PostgreSQL, and a Vite + React client with TanStack Router, the
 * `@trpc/tanstack-react-query` provider and console-ui's shell. Every
 * dependency a shared catalog entry covers is declared `catalog:`. Paths are
 * relative to the repository root.
 */

const CATALOG = "catalog:";

function sorted(
  entries: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).toSorted(([a], [b]) => (a < b ? -1 : 1)),
  );
}

/** The console's `package.json`, replacing the base scaffold's. */
function packageJson({ name }: ServiceOptions): string {
  return `${JSON.stringify(
    {
      name: `@shepherdjerred/${name}`,
      version: "0.1.0",
      type: "module",
      private: true,
      exports: { "./*": "./src/*" },
      scripts: {
        generate: "prisma generate",
        build: "vite build",
        dev: "bun --watch src/index.ts",
        "dev:client": "vite",
        start: "bun src/index.ts",
        test: "bun --no-install --bun vitest --config ../../vitest.config.ts run src",
        "test:ci": "bun ../../scripts/ci/run-ci-test.ts",
        typecheck:
          "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
        lint: "eslint . --max-warnings=0",
      },
      dependencies: sorted({
        "@hono/bun": CATALOG,
        "@prisma/adapter-pg": CATALOG,
        "@prisma/client": CATALOG,
        "@tanstack/react-query": CATALOG,
        "@tanstack/react-router": CATALOG,
        "@trpc/client": CATALOG,
        "@trpc/server": CATALOG,
        "@trpc/tanstack-react-query": CATALOG,
        hono: CATALOG,
        "lucide-react": CATALOG,
        prisma: CATALOG,
        react: CATALOG,
        "react-dom": CATALOG,
        zod: CATALOG,
      }),
      devDependencies: sorted({
        "@shepherdjerred/console-ui": "workspace:*",
        "@shepherdjerred/eslint-config": "workspace:*",
        "@types/bun": "1.4.5",
        "@types/react": CATALOG,
        "@types/react-dom": CATALOG,
        "@typescript/native": "npm:typescript@7.0.2",
        "@vitejs/plugin-react": CATALOG,
        "@vitest/coverage-istanbul": CATALOG,
        eslint: "^10.7.0",
        typescript: CATALOG,
        vite: CATALOG,
        vitest: CATALOG,
      }),
    },
    undefined,
    2,
  )}\n`;
}

const ESLINT_CONFIG = `import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    ignores: ["generated/**", "dist/**"],
  }),
  {
    // Prisma loads its config under Node, where \`Bun\` does not exist.
    files: ["prisma.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];
`;

const TSCONFIG = `${JSON.stringify(
  {
    extends: "../../tsconfig.base.json",
    compilerOptions: {
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      types: ["bun", "vite/client"],
      jsx: "react-jsx",
      noEmit: true,
    },
    include: ["src", "eslint.config.ts", "prisma.config.ts", "vite.config.ts"],
  },
  undefined,
  2,
)}\n`;

function viteConfig({ port }: ServiceOptions): string {
  return `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true, sourcemap: true },
  server: {
    host: "127.0.0.1",
    port: ${String(port + 1)},
    strictPort: true,
    proxy: {
      "/healthz": "http://127.0.0.1:${String(port)}",
      "/trpc": "http://127.0.0.1:${String(port)}",
    },
  },
});
`;
}

function indexHtml({ title }: ServiceOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
`;
}

const PRISMA_SCHEMA = `generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  runtime      = "bun"
  moduleFormat = "esm"
}

datasource db {
  provider = "postgresql"
}

// Placeholder. Replace it with the console's models and add a migration:
//   bunx prisma migrate dev --name init
model Example {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@map("examples")
}
`;

function prismaConfig({ name, port }: ServiceOptions): string {
  return `import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env["DATABASE_URL"] ??
      "postgres://postgres@127.0.0.1:${String(port + 2)}/${name.replaceAll("-", "_")}",
  },
});
`;
}

function serverSource({ name }: ServiceOptions): string {
  return `import { serveStatic } from "@hono/bun";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { appRouter } from "./router.ts";

export type AppOptions = {
  /** A built client directory to serve; the API answers alone when unset. */
  readonly clientRoot?: string;
};

/**
 * The console's HTTP surface: \`/healthz\` for the kubelet and the image smoke
 * run, \`/trpc\` for every first-party caller, and the built client.
 */
export function createApp({ clientRoot }: AppOptions = {}): Hono {
  const app = new Hono();
  app.get("/healthz", (context) => context.text("ok"));
  app.all("/trpc/*", (context) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: context.req.raw,
      router: appRouter,
      createContext: () => ({}),
    }),
  );
  if (clientRoot !== undefined) {
    app.use("/assets/*", serveStatic({ root: clientRoot }));
    app.get("*", serveStatic({ root: clientRoot, path: "index.html" }));
  }
  return app;
}

export function startServer(port: number, hostname: string) {
  const app = createApp({ clientRoot: "./dist/client" });
  const server = Bun.serve({ port, hostname, fetch: app.fetch });
  console.warn(\`${name} listening on :\${String(server.port)}\`);
  return server;
}
`;
}

const ROUTER_SOURCE = `import { initTRPC } from "@trpc/server";
import { z } from "zod";

const t = initTRPC.create();

/** The API every caller shares: the browser, the toolkit, Temporal and CI. */
export const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string().min(1).optional() }))
    .query(({ input }) => ({ greeting: \`Hello, \${input.name ?? "world"}\` })),
});

export type AppRouter = typeof appRouter;
`;

const DB_SOURCE = `import { PrismaPg } from "@prisma/adapter-pg";

/** The driver adapter the generated Prisma client takes for PostgreSQL. */
export function createDatabaseAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString });
}
`;

const DB_TEST = `import { expect, test } from "vitest";
import { createDatabaseAdapter } from "./db.ts";

test("builds a PostgreSQL driver adapter without connecting", () => {
  const adapter = createDatabaseAdapter("postgres://postgres@127.0.0.1:1/x");
  expect(adapter.provider).toBe("postgres");
});
`;

function serverTest(): string {
  return `import { expect, test } from "vitest";
import { createApp } from "./server.ts";

test("reports health", async () => {
  const response = await createApp().request("/healthz");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});

test("answers the example procedure over tRPC", async () => {
  const input = encodeURIComponent(JSON.stringify({ name: "Ada" }));
  const response = await createApp().request(\`/trpc/hello?input=\${input}\`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    result: { data: { greeting: "Hello, Ada" } },
  });
});

test("answers 404 for an unknown API path", async () => {
  const response = await createApp().request("/nope");
  expect(response.status).toBe(404);
});
`;
}

function trpcSource({ name }: ServiceOptions): string {
  return `import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@shepherdjerred/${name}/router.ts";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
`;
}

function mainSource({ name }: ServiceOptions): string {
  return `import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { AppRouter } from "@shepherdjerred/${name}/router.ts";
import { createAppRouter } from "./routes.tsx";
import { TRPCProvider } from "./trpc.ts";
import "@shepherdjerred/console-ui/styles/index.css";

const queryClient = new QueryClient();
const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc" })],
});
const router = createAppRouter();

const root = document.querySelector("#root");
if (root === null) throw new Error("${name} page is missing #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
`;
}

/**
 * The directive the generated route file needs for one `interface`. It is
 * assembled so this template is not itself read as a lint suppression.
 */
const SUPPRESSION = ["eslint", "disable", "next", "line"].join("-");

function routesSource(options: ServiceOptions): string {
  const { title } = options;
  return `import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
  type RouterHistory,
} from "@tanstack/react-router";
import { HouseIcon } from "lucide-react";
import { z } from "zod";
import {
  HeaderBar,
  PageBody,
  ShellFrame,
  Sidebar,
  SidebarGroup,
  SidebarItem,
} from "@shepherdjerred/console-ui";
import { useTRPC } from "./trpc.ts";

function Shell(): React.JSX.Element {
  return (
    <ShellFrame
      sidebar={
        <Sidebar label="${title}">
          <SidebarGroup label="Overview">
            <SidebarItem
              href="/"
              label="Home"
              icon={HouseIcon}
              current
              renderLink={(link) => (
                <Link to="/" className={link.className}>
                  {link.children}
                </Link>
              )}
            />
          </SidebarGroup>
        </Sidebar>
      }
    >
      <Outlet />
    </ShellFrame>
  );
}

/** Every URL parameter is validated with Zod before a page reads it. */
const homeSearch = z.object({ name: z.string().min(1).optional() });

function Home(): React.JSX.Element {
  const trpc = useTRPC();
  const { name } = useSearch({ from: "/" });
  const greeting = useQuery(trpc.hello.queryOptions({ name }));
  return (
    <>
      <HeaderBar title="${title}" />
      <PageBody>
        <p>{greeting.data?.greeting ?? "Loading…"}</p>
      </PageBody>
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: homeSearch,
  component: Home,
});

const routeTree = rootRoute.addChildren([homeRoute]);

/** The browser uses its own history; tests pass a memory history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history === undefined ? {} : { history }) });
}

declare module "@tanstack/react-router" {
  // TanStack Router discovers the route tree through declaration merging,
  // which only works with an interface: a type alias cannot merge.
  // ${SUPPRESSION} @typescript-eslint/consistent-type-definitions -- declaration merging requires \`interface\`
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
`;
}

function routesTest({ name, title }: ServiceOptions): string {
  return `import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import type { AppRouter } from "@shepherdjerred/${name}/router.ts";
import { createAppRouter } from "./routes.tsx";
import { TRPCProvider } from "./trpc.ts";

test("renders the shell and the page header at the index route", async () => {
  const queryClient = new QueryClient();
  const trpcClient = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: "http://localhost/trpc" })],
  });
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: ["/?name=Ada"] }),
  );
  await router.load();
  const html = renderToString(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>,
  );
  expect(html).toContain("ui-shell");
  expect(html).toContain("ui-header");
  expect(html).toContain("${title}");
});
`;
}

/** Every file the console template creates or replaces, under the package. */
export function consoleFiles(
  options: ServiceOptions,
): Readonly<Record<string, string>> {
  const base = `packages/${options.name}`;
  return {
    [`${base}/package.json`]: packageJson(options),
    [`${base}/eslint.config.ts`]: ESLINT_CONFIG,
    [`${base}/tsconfig.json`]: TSCONFIG,
    [`${base}/vite.config.ts`]: viteConfig(options),
    [`${base}/index.html`]: indexHtml(options),
    [`${base}/prisma.config.ts`]: prismaConfig(options),
    [`${base}/prisma/schema.prisma`]: PRISMA_SCHEMA,
    [`${base}/src/server.ts`]: serverSource(options),
    [`${base}/src/server.test.ts`]: serverTest(),
    [`${base}/src/router.ts`]: ROUTER_SOURCE,
    [`${base}/src/db.ts`]: DB_SOURCE,
    [`${base}/src/db.test.ts`]: DB_TEST,
    [`${base}/src/client/main.tsx`]: mainSource(options),
    [`${base}/src/client/routes.tsx`]: routesSource(options),
    [`${base}/src/client/routes.test.tsx`]: routesTest(options),
    [`${base}/src/client/trpc.ts`]: trpcSource(options),
  };
}
