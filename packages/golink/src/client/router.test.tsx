// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createTestQueryClient } from "@shepherdjerred/console-client/testing";
import { createThemeStore } from "@shepherdjerred/console-ui";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { afterEach, describe, expect, test } from "vitest";
import type { AppRouter } from "#shared/trpc-contract.ts";
import { createGolinkRouter } from "./router.tsx";
import { createGolinkTRPCClient, TRPCProvider } from "./trpc.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const noop = (): void => undefined;
// jsdom has no `matchMedia`; the shell asks it for the sidebar breakpoint.
Reflect.set(globalThis, "matchMedia", () => ({
  matches: true,
  addEventListener: noop,
  removeEventListener: noop,
}));
const theme = createThemeStore("golink-theme", {
  storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
  darkQuery: { matches: false, addEventListener: noop },
  root: { dataset: {} },
  onStorage: noop,
});

const unmounts: (() => void)[] = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  document.body.replaceChildren();
});

async function renderAt(url: string): Promise<HTMLElement> {
  const queryClient = createTestQueryClient();
  const trpcClient = createGolinkTRPCClient();
  const trpc = createTRPCOptionsProxy<AppRouter>({
    client: trpcClient,
    queryClient,
  });
  queryClient.setQueryData(trpc.links.list.queryKey(), {
    viewer: { login: null, displayName: null },
    dynamicAliasesEnabled: true,
    writesEnabled: true,
    links: [
      { short: "docs", targetUrl: "https://docs.example.com/", kind: "manual" },
    ],
    shortcuts: [],
  });
  const router = createGolinkRouter(
    theme,
    createMemoryHistory({ initialEntries: [url] }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  unmounts.push(() => {
    root.unmount();
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
          <RouterProvider router={router} />
        </TRPCProvider>
      </QueryClientProvider>,
    );
    await router.load();
  });
  return container;
}

describe("createGolinkRouter", () => {
  test("offers to create a valid ?missing= slug, normalized", async () => {
    const page = await renderAt("/?missing=NewThing");
    expect(page.querySelector(".golink-missing code")?.textContent).toBe(
      "go/newthing",
    );
    expect(page.textContent).toContain("go/docs");
  });

  test("drops a reserved or empty slug instead of showing it", async () => {
    for (const url of ["/?missing=metrics", "/?missing=", "/"]) {
      const page = await renderAt(url);
      expect(page.querySelector(".golink-missing")).toBeNull();
      expect(page.textContent).toContain("go/docs");
    }
  });
});
