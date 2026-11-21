// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "@shepherdjerred/streambot/web/client/app.tsx";
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
