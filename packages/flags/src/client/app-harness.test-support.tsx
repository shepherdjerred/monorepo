import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import type { ThemeStore } from "@shepherdjerred/console-ui";
import { createQueryClient } from "@shepherdjerred/flags/client/api.ts";
import { App } from "@shepherdjerred/flags/client/app.tsx";

const noop = (): void => {
  // Static media queries never fire events here.
};

/** Lets fetches resolve and React Query and React commit what they bring. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

/** jsdom has no `matchMedia`; the top bar asks whether the sidebar shows. */
export function stubNarrowViewport(): void {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: noop,
    removeEventListener: noop,
  }));
}

/**
 * Mounts the whole app at `entry` in a fresh container, beside `probe` (which
 * lets a test read the router's location), and waits for it to settle.
 */
export async function mountApp(
  entry: string,
  theme: ThemeStore,
  probe: ReactNode,
): Promise<{ readonly container: HTMLDivElement; readonly root: Root }> {
  stubNarrowViewport();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[entry]} useTransitions={false}>
          <App theme={theme} />
          {probe}
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  await settle();
  return { container, root };
}
