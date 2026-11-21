import { afterEach, expect, test, vi } from "vitest";
import { MeSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ARTWORK_HOSTS } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import { webFixture } from "./web-fixture.ts";

// A fixture DSN in the Bugsink shape; the key is fake and must never reach the CSP.
const FAKE_DSN =
  "https://0123456789abcdef0123456789abcdef@errors.example.test/42";
// The artwork list predates this policy and has its own tests; it is spelled out from its source.
const ARTWORK =
  "img-src 'self' " + ARTWORK_HOSTS.map((host) => "https://" + host).join(" ");

let fixture: ReturnType<typeof webFixture>;
afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
});

async function me() {
  const response = await fixture.handler(
    new Request("http://127.0.0.1:8080/api/me", {
      headers: { cookie: fixture.cookie },
    }),
  );
  expect(response.status).toBe(200);
  return {
    csp: response.headers.get("content-security-policy"),
    body: MeSchema.parse(await response.json()),
  };
}

test("without Bugsink the policy allows only self, artwork and the PostHog proxy, and /api/me has no DSN", async () => {
  fixture = webFixture();
  const { csp, body } = await me();
  expect(csp).toBe(
    "default-src 'self'; script-src 'self' https://j.sjer.red; style-src 'self'; " +
      ARTWORK +
      "; connect-src 'self' https://j.sjer.red; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  expect(body.bugsinkDsn).toBeNull();
});

test("with Bugsink the policy adds exactly the DSN's origin, never its key, and /api/me hands out the DSN", async () => {
  const written: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    bugsinkDsn: FAKE_DSN,
  });
  const { csp, body } = await me();
  // The request was logged and measured; neither the log line nor any metric carries the key.
  expect(written.join("")).toContain('"route":"/api/me"');
  expect(written.join("")).not.toContain("0123456789abcdef");
  expect(await register.metrics()).not.toContain("0123456789abcdef");
  expect(csp).toBe(
    "default-src 'self'; script-src 'self' https://j.sjer.red; style-src 'self'; " +
      ARTWORK +
      "; connect-src 'self' https://j.sjer.red https://errors.example.test; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  expect(csp).not.toContain("0123456789abcdef");
  expect(body.bugsinkDsn).toBe(FAKE_DSN);
});

test("static pages carry the same policy as API responses", async () => {
  fixture = webFixture();
  const page = await fixture.handler(
    new Request("http://127.0.0.1:8080/healthz"),
  );
  const { csp } = await me();
  expect(page.headers.get("content-security-policy")).toBe(csp);
});
