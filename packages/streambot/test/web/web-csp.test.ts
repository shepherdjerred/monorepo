import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MeSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ARTWORK_HOSTS } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import type { BugsinkReporting } from "@shepherdjerred/streambot/observability/bugsink.ts";
import { ANALYTICS_SITE } from "@shepherdjerred/streambot/web/shared/analytics-site.ts";
import { webFixture } from "./web-fixture.ts";

const PRODUCTION = "https://streambot.sjer.red";
const LOCAL = "http://127.0.0.1:8080";
// Fixture keys in the Bugsink DSN shape; neither must reach the CSP, a log line or a metric.
const DSN_KEY = "fixturepublickey0123";
const PUBLIC: BugsinkReporting = {
  dsn: `https://${DSN_KEY}@bugsink.sjer.red/14`,
  release: "1.2.3",
  environment: "production",
};
// The artwork list predates this policy and has its own tests; it is spelled out from its source.
const ARTWORK =
  "img-src 'self' " + ARTWORK_HOSTS.map((host) => "https://" + host).join(" ");
// The SDK's extension scripts and this project's remote config, nothing else on the proxy.
const POSTHOG_SCRIPTS = `https://j.sjer.red/static/ https://j.sjer.red/array/${ANALYTICS_SITE.projectToken}/`;

function policy(script: string, connect: string): string {
  return (
    `default-src 'self'; script-src ${script}; style-src 'self'; ` +
    ARTWORK +
    `; connect-src ${connect}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  );
}

let fixture: ReturnType<typeof webFixture> | undefined;
let assets: string | undefined;
afterEach(async () => {
  fixture?.close();
  fixture = undefined;
  if (assets !== undefined) await rm(assets, { recursive: true, force: true });
  assets = undefined;
  vi.restoreAllMocks();
});

function open(
  origin: string,
  bugsink?: BugsinkReporting,
  assetsDir = "/nonexistent",
) {
  const opened = webFixture(
    origin,
    assetsDir,
    false,
    bugsink === undefined ? {} : { bugsink },
  );
  fixture = opened;
  return opened;
}

async function me(opened: ReturnType<typeof webFixture>, origin: string) {
  const response = await opened.handler(
    new Request(origin + "/api/me", { headers: { cookie: opened.cookie } }),
  );
  expect(response.status).toBe(200);
  return {
    csp: response.headers.get("content-security-policy"),
    body: MeSchema.parse(await response.json()),
  };
}

describe("content security policy", () => {
  test("off the production host there is no PostHog and, without Bugsink, no error host", async () => {
    const { csp, body } = await me(open(LOCAL), LOCAL);
    expect(csp).toBe(policy("'self'", "'self'"));
    expect(body.bugsink).toBeNull();
  });

  test("on the production host scripts are limited to the SDK's paths on the proxy, plus the public Bugsink origin", async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    const { csp, body } = await me(open(PRODUCTION, PUBLIC), PRODUCTION);
    expect(csp).toBe(
      policy(
        "'self' " + POSTHOG_SCRIPTS,
        "'self' https://j.sjer.red https://bugsink.sjer.red",
      ),
    );
    expect(body.bugsink).toEqual(PUBLIC);
    // The request was logged and measured; neither the log line nor any metric carries the key.
    expect(written.join("")).toContain('"route":"/api/me"');
    expect(written.join("")).not.toContain(DSN_KEY);
    expect(await register.metrics()).not.toContain(DSN_KEY);
    expect(csp).not.toContain(DSN_KEY);
  });

  test("the built pages / and /classic carry the same policy as the API", async () => {
    assets = await mkdtemp(path.join(tmpdir(), "streambot-csp-"));
    for (const page of ["client", "client-classic"]) {
      await mkdir(path.join(assets, page));
      await writeFile(
        path.join(assets, page, "index.html"),
        "<!doctype html><title>Streambot</title>",
      );
    }
    const opened = open(PRODUCTION, PUBLIC, assets);
    const { csp } = await me(opened, PRODUCTION);
    for (const page of ["/", "/classic"]) {
      const response = await opened.handler(new Request(PRODUCTION + page));
      expect(response.status, page).toBe(200);
      expect(await response.text(), page).toContain("<title>Streambot");
      expect(response.headers.get("content-security-policy"), page).toBe(csp);
    }
  });
});

describe("browser Bugsink reporting", () => {
  test.each([
    [
      "a cluster-internal host",
      "http://bugsink.bugsink.svc.cluster.local:8000/14",
    ],
    ["plain HTTP on the public host", "http://fixturekey@bugsink.sjer.red/14"],
    ["another HTTPS host", "https://fixturekey@errors.example.test/14"],
    ["a non-default port", "https://fixturekey@bugsink.sjer.red:8443/14"],
  ])("a DSN on %s never reaches the browser or the CSP", async (_case, dsn) => {
    const { csp, body } = await me(
      open(PRODUCTION, { ...PUBLIC, dsn }),
      PRODUCTION,
    );
    expect(body.bugsink).toBeNull();
    expect(csp).toBe(
      policy("'self' " + POSTHOG_SCRIPTS, "'self' https://j.sjer.red"),
    );
  });

  test("a server without a release reports a null release", async () => {
    const { body } = await me(
      open(PRODUCTION, { ...PUBLIC, release: null }),
      PRODUCTION,
    );
    expect(body.bugsink).toEqual({ ...PUBLIC, release: null });
  });
});
