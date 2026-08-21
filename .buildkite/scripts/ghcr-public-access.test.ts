import { expect, test } from "vitest";

import {
  ensureAnonymousGhcrPull,
  type GhcrFetcher,
} from "./ghcr-public-access.ts";

const digest = `sha256:${"a".repeat(64)}`;

function isTokenRequest(input: string | URL): boolean {
  return String(input).startsWith("https://ghcr.io/token");
}

const anonymousTokenGranted: GhcrFetcher = async (input) =>
  isTokenRequest(input)
    ? Response.json({ token: "anonymous" })
    : Response.json({}, { status: 200 });

const anonymousTokenDenied: GhcrFetcher = async () =>
  Response.json({}, { status: 401 });

const noWait = { sleeper: async () => 0, attempts: 1 };

test("resolves once the manifest is anonymously readable", async () => {
  await ensureAnonymousGhcrPull("birmel", digest, {
    ...noWait,
    fetcher: anonymousTokenGranted,
  });
});

// A package GitHub never made public denies the anonymous token, and CI
// cannot repair that: the Packages REST API has no visibility mutation.
test("names the one-time manual fix for a declared-public target", async () => {
  const failure: unknown = await ensureAnonymousGhcrPull("birmel", digest, {
    ...noWait,
    fetcher: anonymousTokenDenied,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(Error);
  const message = failure instanceof Error ? failure.message : "";
  expect(message).toContain("is not anonymously pullable");
  expect(message).toContain("declared public in IMAGE_TARGET_REGISTRY");
  expect(message).toContain(
    "https://github.com/users/shepherdjerred/packages/container/birmel/settings",
  );
});

test("omits the first-party remediation for images the repo only mirrors", async () => {
  const failure: unknown = await ensureAnonymousGhcrPull("redlib", digest, {
    ...noWait,
    fetcher: anonymousTokenDenied,
  }).catch((error: unknown) => error);

  const message = failure instanceof Error ? failure.message : "";
  expect(message).toContain("is not anonymously pullable");
  expect(message).not.toContain("IMAGE_TARGET_REGISTRY");
});

test("retries a transient manifest 404 before giving up", async () => {
  let manifestCalls = 0;
  const fetcher: GhcrFetcher = async (input) => {
    if (isTokenRequest(input)) return Response.json({ token: "anonymous" });
    manifestCalls += 1;
    return Response.json({}, { status: 404 });
  };

  const failure: unknown = await ensureAnonymousGhcrPull("birmel", digest, {
    sleeper: async () => 0,
    attempts: 3,
    fetcher,
  }).catch((error: unknown) => error);

  expect(manifestCalls).toBe(3);
  expect(failure).toBeInstanceOf(Error);
});
