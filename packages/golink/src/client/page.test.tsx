import {
  createTestQueryClient,
  renderWithRouter,
} from "@shepherdjerred/console-client/testing";
import { createThemeStore } from "@shepherdjerred/console-ui";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { describe, expect, test } from "vitest";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#shared/trpc-contract.ts";
import { App } from "./app.tsx";
import { missingSlugUrl } from "./router.tsx";
import { createGolinkTRPCClient, TRPCProvider } from "./trpc.ts";

type LinksDirectoryResponse = inferRouterOutputs<AppRouter>["links"]["list"];

const noop = (): void => undefined;

const DIRECTORY: LinksDirectoryResponse = {
  viewer: { login: "jerred@sjer.red", displayName: "Jerred" },
  dynamicAliasesEnabled: true,
  writesEnabled: true,
  links: [
    {
      short: "docs",
      targetUrl: "https://docs.example.com/",
      kind: "manual",
      clicks: 3,
    },
    {
      short: "argocd",
      targetUrl: "https://argocd.tailnet.example/",
      kind: "ingress",
    },
  ],
  shortcuts: [],
};

const theme = createThemeStore("golink-theme", {
  storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
  darkQuery: { matches: false, addEventListener: noop },
  root: { dataset: {} },
  onStorage: noop,
});

/** The page as the router renders it, with the directory query seeded. */
function renderPage(
  missingSlug: string | null,
  directory?: LinksDirectoryResponse,
) {
  const queryClient = createTestQueryClient();
  const trpcClient = createGolinkTRPCClient();
  if (directory !== undefined) {
    const trpc = createTRPCOptionsProxy<AppRouter>({
      client: trpcClient,
      queryClient,
    });
    queryClient.setQueryData(trpc.links.list.queryKey(), directory);
  }
  return renderWithRouter(
    <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
      <App theme={theme} missingSlug={missingSlug} />
    </TRPCProvider>,
    { queryClient },
  );
}

describe("Go link page through the router and query providers", () => {
  test("renders the directory from the tRPC query", () => {
    const html = renderPage(null, DIRECTORY);
    expect(html).toContain("go/docs");
    expect(html).toContain("go/argocd");
    expect(html).toContain(">New link<");
    expect(html).not.toContain("does not exist yet");
  });

  test("offers to create a missing slug from ?missing=", () => {
    const html = renderPage("newthing", DIRECTORY);
    expect(html).toContain(
      '<code class="golink-short">go/newthing</code> does not exist yet.',
    );
    expect(html).toContain("Create go/newthing");
  });

  test("shows dashes while the directory loads", () => {
    const html = renderPage(null);
    expect(html).not.toContain("go/docs");
    expect(html).toContain("—");
  });
});

describe("missingSlugUrl", () => {
  test("rewrites an unresolved go/<slug> path onto the one route", () => {
    expect(missingSlugUrl("/", "")).toBeNull();
    expect(missingSlugUrl("/New%20Thing/", "")).toBe("/?missing=New+Thing");
    expect(missingSlugUrl("/docs", "?missing=other")).toBe("/?missing=other");
  });
});
