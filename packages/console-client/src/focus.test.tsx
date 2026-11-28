// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { focusOnNavigate } from "./router.tsx";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function Page({ title }: { readonly title: string }) {
  return (
    <main>
      <button type="button">Skip</button>
      <h1 id="main-heading" tabIndex={-1}>
        {title}
      </h1>
    </main>
  );
}

function mountRouter() {
  const rootRoute = createRootRoute();
  const routes = ["/", "/a", "/b"].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <Page title={path} />,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { router, root, container };
}

/** Lets the one-frame focus retry run before the reader moves on. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  });
}

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  for (const entry of mounted.splice(0)) entry.unmount();
  document.body.replaceChildren();
});

describe("focusOnNavigate", () => {
  it("focuses the new page's heading after a navigation, not on first load", async () => {
    const { router, root } = mountRouter();
    mounted.push(root);
    const unsubscribe = focusOnNavigate(router);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
      await router.load();
    });
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      await router.navigate({ to: "/a" });
    });
    const heading = document.querySelector("#main-heading");
    expect(heading?.textContent).toBe("/a");
    expect(document.activeElement).toBe(heading);

    // After unsubscribing, the next page's heading is not focused.
    unsubscribe();
    await act(async () => {
      await router.navigate({ to: "/b" });
    });
    expect(document.querySelector("#main-heading")?.textContent).toBe("/b");
    expect(document.activeElement).toBe(document.body);
  });

  it("lets a function choose targets, e.g. nothing for a search-only change", async () => {
    const { router, root } = mountRouter();
    mounted.push(root);
    focusOnNavigate(router, (event) =>
      event.pathChanged ? ["#absent", "#main-heading"] : [],
    );
    await act(async () => {
      root.render(<RouterProvider router={router} />);
      await router.load();
    });
    await act(async () => {
      await router.navigate({ to: "/a" });
    });
    expect(document.activeElement?.id).toBe("main-heading");
    await nextFrame();
    document.querySelector("button")?.focus();
    await act(async () => {
      await router.navigate({ to: "/a", search: { page: 2 } });
    });
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});
