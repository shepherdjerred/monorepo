import { afterAll, expect, test } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import { analyzeJavaScript } from "./sandbox.ts";

const db = createTestDatabase("explore-sandbox");
afterAll(async () => {
  await dropTestDatabase(db.prisma, db.dbPath);
});
const run = (code: string, signal = new AbortController().signal) =>
  analyzeJavaScript(
    {
      code,
      datasets: JSON.stringify({
        selected: [{ value: 1 }, { value: 2 }, { value: 3 }],
      }),
      signal,
    },
    db.prisma,
  );

test("calculates over every selected row without host privileges", async () => {
  expect(
    await run(
      "return { sum: datasets.selected.reduce((sum, row) => sum + row.value, 0), privileges: [typeof process, typeof Bun, typeof fetch, typeof require] };",
    ),
  ).toEqual({
    ok: true,
    value: {
      sum: 6,
      privileges: ["undefined", "undefined", "undefined", "undefined"],
    },
  });
});
test("rejects asynchronous and excessive output", async () => {
  expect(await run("return Promise.resolve(1);")).toMatchObject({ ok: false });
  expect(await run("return 'x'.repeat(65537);")).toMatchObject({ ok: false });
});
test("limits memory without bringing down the host", async () => {
  expect(
    await run("return new ArrayBuffer(512 * 1024 * 1024).byteLength;"),
  ).toMatchObject({ ok: false });
  expect(await run("return 42;")).toEqual({ ok: true, value: 42 });
});
test(
  "kills an infinite loop at the deadline and releases its lease",
  { timeout: 20_000 },
  async () => {
    const start = Date.now();
    expect(await run("while (true) {}")).toMatchObject({ ok: false });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(9000);
    expect(elapsed).toBeLessThan(12_000);
    expect(await db.prisma.exploreSandboxLease.count()).toBe(0);
  },
);
test("aborting terminates a worker and releases global capacity", async () => {
  const controller = new AbortController();
  const promise = run("while (true) {}", controller.signal);
  setTimeout(() => controller.abort(), 100);
  await expect(promise).rejects.toHaveProperty("name", "AbortError");
  expect(await db.prisma.exploreSandboxLease.count()).toBe(0);
});
test("respects shared capacity and reclaims expired leases", async () => {
  await db.prisma.exploreSandboxLease.createMany({
    data: [
      { expiresAt: new Date(Date.now() + 15_000) },
      { expiresAt: new Date(Date.now() + 15_000) },
    ],
  });
  expect(await run("return 42;")).toMatchObject({
    ok: false,
    message: expect.stringMatching(/busy/u),
  });
  await db.prisma.exploreSandboxLease.updateMany({
    data: { expiresAt: new Date(0) },
  });
  expect(await run("return 42;")).toEqual({ ok: true, value: 42 });
  expect(await db.prisma.exploreSandboxLease.count()).toBe(0);
});
