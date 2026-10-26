import { createServer } from "node:http";
import { afterAll, expect, test } from "vitest";
import { readPmsBootstrap, until } from "#e2e/pms/http.ts";

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
