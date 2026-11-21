// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "@shepherdjerred/streambot/web/client/app.tsx";
import { mount, perform, stubFetch } from "./harness.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PLAYLIST = "0b6f4b1e-0000-4000-8000-000000000000";

/** The sign-in link a signed-out viewer sees on `entry`. */
async function signInHref(entry: string): Promise<URL> {
  const calls = stubFetch();
  const view = await mount(
    <MemoryRouter initialEntries={[entry]}>
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
  await view.unmount();
  expect(href.pathname).toBe("/api/auth/discord/start");
  return href;
}

test("signing in returns to the page without its search text", async () => {
  const href = await signInHref("/library?q=private+words");
  expect(href.searchParams.get("returnTo")).toBe("/library");
  expect(href.href).not.toContain("private");
});

test("signing in from a playlist share link keeps its server", async () => {
  const href = await signInHref(
    `/playlists/${PLAYLIST}?guild=100000000000000010&q=private+words`,
  );
  expect(href.searchParams.get("returnTo")).toBe(
    `/playlists/${PLAYLIST}?guild=100000000000000010`,
  );
  expect(href.href).not.toContain("private");
});

test("signing in from a Discord playlist link keeps its server and playlist", async () => {
  const href = await signInHref(
    `/playlists?guild=100000000000000010&playlist=${PLAYLIST}`,
  );
  expect(href.searchParams.get("returnTo")).toBe(
    `/playlists?guild=100000000000000010&playlist=${PLAYLIST}`,
  );
});

test("share-link parameters of the wrong shape are dropped", async () => {
  const href = await signInHref(
    "/playlists?guild=private+words&playlist=private+words&import=https%3A%2F%2Fexample.com",
  );
  expect(href.searchParams.get("returnTo")).toBe("/playlists");
  expect(href.href).not.toContain("private");
  expect(href.href).not.toContain("example.com");
});
