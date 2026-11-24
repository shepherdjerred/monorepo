import { expect, test } from "vitest";
import { Hono } from "hono";
import { canonicalMediaHtmlOrigin } from "./canonical-origin.ts";

const canonical = "https://seerr.sjer.red";
function fixture() {
  const app = new Hono();
  app.use(canonicalMediaHtmlOrigin(canonical));
  app.all("*", (c) => c.text("Actual next handler"));
  return app;
}

test.each(["https", "http"] as const)(
  "exact previous %s owner bookmark keeps path/query at public canonical",
  async (scheme) => {
    const response = await fixture().request(
      `${scheme}://media.tailnet-1a49.ts.net/library?view=kept`,
      { headers: { Accept: "text/html,application/xhtml+xml" } },
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      `${canonical}/library?view=kept`,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
  },
);

test.each([
  ["https://media.tailnet-1a49.ts.net/api/v1/library", "GET", "text/html"],
  ["https://media.tailnet-1a49.ts.net/assets/app.js", "GET", "text/html"],
  ["https://media.tailnet-1a49.ts.net/readyz", "GET", "text/html"],
  ["https://media.tailnet-1a49.ts.net/metrics", "GET", "text/html"],
  ["https://media.tailnet-1a49.ts.net/library", "POST", "text/html"],
  ["https://media.tailnet-1a49.ts.net/library", "GET", "application/json"],
  ["https://media.tailnet-1a49.ts.net/library", "GET", "text/html;q=0"],
  [
    "https://media.tailnet-1a49.ts.net.evil.example/library",
    "GET",
    "text/html",
  ],
  ["https://media.tailnet-1a49.ts.net:7352/library", "GET", "text/html"],
  ["https://seerr.sjer.red/library", "GET", "text/html"],
] as const)(
  "%s %s stays outside HTML alias handling (%s)",
  async (url, method, accept) => {
    const response = await fixture().request(url, {
      method,
      headers: {
        Accept: accept,
        "X-Forwarded-Host": "media.tailnet-1a49.ts.net",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
  },
);

test("encoded path cannot change the canonical host", async () => {
  const response = await fixture().request(
    "https://media.tailnet-1a49.ts.net/%2f%2fevil.example/?next=https://evil.example",
    { headers: { Accept: "text/html" } },
  );
  const target = new URL(response.headers.get("Location") ?? "invalid");
  expect(target.origin).toBe(canonical);
  expect(target.pathname).toBe("/%2f%2fevil.example/");
});
