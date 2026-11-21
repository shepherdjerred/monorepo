// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "@shepherdjerred/streambot/web/client/app.tsx";
import {
  App as ClassicApp,
  CLASSIC_BASENAME,
} from "@shepherdjerred/streambot/web/client-classic/app.tsx";
import { mount, perform, stubFetch } from "./harness.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("signing in returns to the page without its search text", async () => {
  const calls = stubFetch();
  const view = await mount(
    <MemoryRouter initialEntries={["/library?q=private+words"]}>
      <App />
    </MemoryRouter>,
  );
  const me = calls.find((call) => call.url === "/api/me");
  await perform(() => {
    me?.answer(401, { code: "unauthorized", message: "Sign in." });
  });

  const link = view.container.querySelector("a.btn-watch");
  const href = new URL(
    link?.getAttribute("href") ?? "",
    "https://streambot.test",
  );
  expect(href.pathname).toBe("/api/auth/discord/start");
  expect(href.searchParams.get("returnTo")).toBe("/library");
  expect(href.href).not.toContain("private");
  await view.unmount();
});

/** jsdom lays nothing out, so the classic page's size watcher only needs to exist. */
class InertResizeObserver {
  observe(): void {
    // No layout in jsdom.
  }
  unobserve(): void {
    // No layout in jsdom.
  }
  disconnect(): void {
    // No layout in jsdom.
  }
}

test("signing in from the classic remote returns to the classic remote", async () => {
  vi.stubGlobal("ResizeObserver", InertResizeObserver);
  const calls = stubFetch();
  const view = await mount(
    <MemoryRouter
      basename={CLASSIC_BASENAME}
      initialEntries={["/classic/plex"]}
    >
      <ClassicApp />
    </MemoryRouter>,
  );
  await perform(() => {
    for (const call of calls.filter((entry) => entry.url === "/api/me"))
      call.answer(401, { code: "unauthorized", message: "Sign in." });
  });

  const link = view.container.querySelector("a.sign-in");
  const href = new URL(
    link?.getAttribute("href") ?? "",
    "https://streambot.test",
  );
  expect(href.pathname).toBe("/api/auth/discord/start");
  expect(href.searchParams.get("returnTo")).toBe("/classic/plex");
  await view.unmount();
});
