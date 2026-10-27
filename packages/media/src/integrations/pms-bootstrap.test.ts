import { createServer } from "node:http";
import { afterAll, expect, test } from "vitest";
import {
  readPmsBootstrap,
  readPmsLibraryReady,
  readPmsPluginsReady,
  until,
} from "#e2e/pms/http.ts";

const statuses: number[] = [];
const paths: string[] = [];
const server = createServer((request, response) => {
  paths.push(request.url ?? "");
  const status = statuses.shift();
  if (status === undefined) throw new Error("Unexpected bootstrap request");
  response.writeHead(status);
  response.end("Synthetic local PMS identity");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string")
  throw new Error("Missing local HTTP port");
const origin = `http://127.0.0.1:${String(address.port)}`;
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
});
const request = async (url: string, init: RequestInit) => {
  expect(url).toBe("http://127.0.0.1:32400/identity");
  return await fetch(`${origin}/identity`, init);
};

test("local bootstrap polls an HTTP 503 then requires an HTTP 200", async () => {
  statuses.push(503, 200);
  const before = paths.length;
  const signal = AbortSignal.timeout(2000);
  expect(
    await until(
      "Synthetic bootstrap",
      () => readPmsBootstrap(signal, request),
      signal,
    ),
  ).toBe(true);
  expect(paths.slice(before)).toEqual(["/identity", "/identity"]);
  expect(statuses).toEqual([]);
});

test.each([401, 403, 404, 500])(
  "local bootstrap fails immediately on HTTP %s",
  async (status) => {
    statuses.push(status);
    const before = paths.length;
    const signal = AbortSignal.timeout(2000);
    await expect(
      until(
        "Synthetic bootstrap",
        () => readPmsBootstrap(signal, request),
        signal,
      ),
    ).rejects.toThrow(`HTTP ${String(status)}`);
    expect(paths.length).toBe(before + 1);
  },
);

test("local bootstrap retains its caller deadline while PMS stays unavailable", async () => {
  statuses.push(503);
  const signal = AbortSignal.timeout(50);
  const before = paths.length;
  await expect(
    until(
      "Synthetic bootstrap",
      () => readPmsBootstrap(signal, request),
      signal,
    ),
  ).rejects.toThrow("Synthetic bootstrap deadline expired");
  expect(paths.length).toBe(before + 1);
});

test("library readiness waits through startup 404/503 and proves the read API before any mutation", async () => {
  const seen: string[] = [];
  const responses = [
    new Response("Not found", { status: 404 }),
    new Response("Starting", { status: 503 }),
    Response.json({ MediaContainer: { size: 0 } }),
  ];
  const signal = AbortSignal.timeout(2000);
  expect(
    await until(
      "Synthetic library startup",
      () =>
        readPmsLibraryReady(signal, (url, init) => {
          seen.push(url);
          expect(init.method).toBeUndefined();
          const response = responses.shift();
          if (response === undefined)
            throw new Error("Unexpected startup read");
          return Promise.resolve(response);
        }),
      signal,
    ),
  ).toBe(true);
  expect(seen).toEqual(
    Array.from({ length: 3 }, () => "http://127.0.0.1:32400/library/sections"),
  );
});

test.each([401, 403, 500])(
  "library readiness refuses HTTP %s rather than retrying a mutation",
  async (status) => {
    await expect(
      readPmsLibraryReady(AbortSignal.timeout(2000), () =>
        Promise.resolve(new Response("Unavailable", { status })),
      ),
    ).rejects.toThrow(`HTTP ${String(status)}`);
  },
);

test("mutation readiness waits for the actual startup state to clear without sending a mutation", async () => {
  const states = [{ startState: "startingPlugins" }, {}];
  const methods: (string | undefined)[] = [];
  const signal = AbortSignal.timeout(2000);
  expect(
    await until(
      "PMS plugins",
      () =>
        readPmsPluginsReady(signal, (url, init) => {
          expect(url).toBe("http://127.0.0.1:32400/identity");
          methods.push(init.method);
          const state = states.shift();
          if (state === undefined) throw new Error("Unexpected readiness read");
          return Promise.resolve(Response.json({ MediaContainer: state }));
        }),
      signal,
    ),
  ).toBe(true);
  expect(methods).toEqual([undefined, undefined]);
});

test("unknown startup states fail rather than being assumed ready", async () => {
  await expect(
    readPmsPluginsReady(AbortSignal.timeout(2000), () =>
      Promise.resolve(
        Response.json({ MediaContainer: { startState: "unexpected" } }),
      ),
    ),
  ).rejects.toThrow();
});
