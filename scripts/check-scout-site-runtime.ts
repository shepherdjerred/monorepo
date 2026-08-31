#!/usr/bin/env bun

/**
 * Verify the public Scout static-site and reverse-proxy contract.
 *
 * This is intentionally a live HTTP check rather than a Caddyfile snapshot:
 * the regression only appears when the custom S3 proxy streams an object.
 */

const origin = new URL(Bun.argv[2] ?? "https://beta.scout-for-lol.com");
origin.pathname = origin.pathname.replace(/\/$/, "");

const EXPECTED_CSP_PARTS = [
  "connect-src 'self' https://us.i.posthog.com https://bugsink.sjer.red https://ct.pinterest.com https://pixel-config.reddit.com https://events.reddit.com",
  "img-src 'self' https://cdn.discordapp.com https://ddragon.leagueoflegends.com https://ct.pinterest.com data: blob:",
];

const EXPECTED_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "required",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  // Cloudflare may overlay its own HSTS policy on the public origin; the
  // in-cluster Caddy response is checked for the exact configured value.
  "strict-transport-security": "required",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function urlFor(path: string): URL {
  return new URL(path, origin);
}

async function get(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(urlFor(path), init);
  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status.toString()} ${response.statusText}`,
    );
  }
  return response;
}

function assertHeaders(path: string, response: Response): void {
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    const value = response.headers.get(name);
    if (value === null) {
      throw new Error(`${path} is missing ${name}`);
    }
    if (expected !== "required" && !value.startsWith(expected)) {
      throw new Error(`${path} has unexpected ${name}: ${value}`);
    }
  }

  const csp = response.headers.get("content-security-policy");
  if (csp === null) {
    throw new Error(`${path} is missing Content-Security-Policy`);
  }
  for (const part of EXPECTED_CSP_PARTS) {
    if (!csp.includes(part)) {
      throw new Error(`${path} CSP is missing: ${part}`);
    }
  }
}

async function main(): Promise<void> {
  const root = await get("/");
  assertHeaders("/", root);
  const rootHtml = await root.text();
  if (origin.hostname === "beta.scout-for-lol.com") {
    for (const placeholder of [
      "beta-placeholder-pinterest-tag-id",
      "beta-placeholder-reddit-pixel-id",
    ]) {
      if (rootHtml.includes(placeholder)) {
        throw new Error(`beta page still contains ${placeholder}`);
      }
    }
  }

  for (const path of ["/app/", "/docs/"]) {
    const response = await get(path);
    assertHeaders(path, response);
  }

  const spaFallback = await get("/app/csp-regression-check");
  assertHeaders("/app/csp-regression-check", spaFallback);

  const appResponse = await get("/app/");
  const appHtml = await appResponse.text();
  const assetPath = /src="(\/app\/assets\/[^"]+\.js)"/.exec(appHtml)?.[1];
  if (assetPath === undefined) {
    throw new Error("/app/ did not identify a same-origin JavaScript asset");
  }

  const asset = await get(assetPath);
  assertHeaders(assetPath, asset);
  const range = await get(assetPath, {
    headers: { Range: "bytes=0-31" },
  });
  assertHeaders(`${assetPath} (range)`, range);
  if (range.status !== 206) {
    throw new Error(
      `${assetPath} range request returned ${range.status.toString()}`,
    );
  }
  const contentRange = range.headers.get("content-range");
  if (contentRange?.startsWith("bytes 0-31/") !== true) {
    throw new Error(`${assetPath} range response is missing Content-Range`);
  }

  const healthz = await get("/api/healthz");
  assertHeaders("/api/healthz", healthz);

  const sourceMap = await get(`${assetPath}.map`);
  if (sourceMap.status !== 200) {
    throw new Error(`${assetPath}.map did not return 200`);
  }

  console.log(`Scout site runtime contract passed for ${origin.origin}`);
}

await main();
