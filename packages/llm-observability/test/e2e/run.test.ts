import { afterEach, expect, test } from "vitest";
import {
  E2E_MINIO_HOST_VARIABLE,
  E2E_TEMPO_HOST_VARIABLE,
  GATEWAY_ARCHIVE_E2E_TIMEOUT_MS,
  TEMPO_TRACE_POLL_TIMEOUT_MS,
  createArchiveBucket,
  e2eEnvironment,
  waitForTempo,
} from "./run-core.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("passes the selected service hosts to the e2e process", () => {
  expect(e2eEnvironment({ tempo: "tempo", minio: "minio" })).toEqual({
    [E2E_TEMPO_HOST_VARIABLE]: "tempo",
    [E2E_MINIO_HOST_VARIABLE]: "minio",
  });
});

test("stops checking once Tempo is ready", async () => {
  let attempts = 0;
  await waitForTempo(async () => {
    attempts += 1;
    return true;
  }, 2);
  expect(attempts).toBe(1);
});

test("fails after the configured attempts", async () => {
  await expect(waitForTempo(async () => false, 1, 0)).rejects.toThrow(
    "Tempo did not become ready",
  );
});

test("gateway archive e2e outlives the Tempo poll deadline", async () => {
  expect(GATEWAY_ARCHIVE_E2E_TIMEOUT_MS).toBeGreaterThan(
    TEMPO_TRACE_POLL_TIMEOUT_MS,
  );
  const gatewayTest = await Bun.file(
    new URL("gateway-archive.e2e.test.ts", import.meta.url),
  ).text();
  const poll = await Bun.file(new URL("helpers.ts", import.meta.url)).text();
  expect(gatewayTest).toContain("GATEWAY_ARCHIVE_E2E_TIMEOUT_MS,");
  expect(poll).toContain("options.timeoutMs ?? TEMPO_TRACE_POLL_TIMEOUT_MS");
});

test("creates the archive bucket once the S3 health probe succeeds", async () => {
  const seen: { url: string; method: string; authorization: string | null }[] =
    [];
  let calls = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (calls === 1) throw new Error("connection refused");
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        method: init?.method ?? "GET",
        authorization: headers.get("Authorization"),
      });
      return new Response("", { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );

  await createArchiveBucket("http://localhost:9000", 3, 0);
  expect(seen).toEqual([
    {
      url: "http://localhost:9000/minio/health/live",
      method: "GET",
      authorization: null,
    },
    {
      url: "http://localhost:9000/llm-archive",
      method: "PUT",
      authorization: expect.stringContaining(
        "AWS4-HMAC-SHA256 Credential=minioadmin/",
      ),
    },
  ]);
});

test("fails when the S3 health probe or bucket PUT fails", async () => {
  globalThis.fetch = Object.assign(
    async () => new Response("starting", { status: 503 }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    createArchiveBucket("http://localhost:9000", 1, 0),
  ).rejects.toThrow("S3 service did not become ready");

  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return url.endsWith("/minio/health/live")
        ? new Response("ok", { status: 200 })
        : new Response("denied", { status: 403 });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    createArchiveBucket("http://localhost:9000", 1, 0),
  ).rejects.toThrow("Archive bucket creation failed: 403 denied");
});
