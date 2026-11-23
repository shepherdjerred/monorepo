import { expect, test } from "bun:test";
import { createDirectSessionResourceLoader } from "./latest-direct-session-preparation-io.mjs";
import { createDirectSessionInitializationFactory } from "./latest-direct-session-initialization.mjs";
test("preparation loader shares real in-flight reads without exposing or replacing source bytes", async () => {
  let reads = 0;
  const bytes = new Uint8Array([1, 2, 3]),
    load = createDirectSessionResourceLoader("file:///owned/", async (file) => {
      reads++;
      expect(file).toBe("a.bin");
      return bytes;
    });
  const a = load("a.bin"),
    b = load("a.bin");
  expect(a).toBe(b);
  expect(await a).toBe(bytes);
  expect(reads).toBe(1);
  expect(await load("a.bin")).toBe(bytes);
  expect(reads).toBe(1);
});
test("invalid preparation I/O fails without trying a different authority", async () => {
  expect(() =>
    createDirectSessionResourceLoader("file:///owned/", {}),
  ).toThrow();
  let reads = 0;
  const load = createDirectSessionResourceLoader("file:///owned/", async () => {
    reads++;
    return new ArrayBuffer(8);
  });
  await expect(load("bad.bin")).rejects.toThrow(
    "Preparation resource bytes required",
  );
  await expect(load("bad.bin")).rejects.toThrow(
    "Preparation resource bytes required",
  );
  expect(reads).toBe(1);
});
test("initialization issuance consumes and releases its holder even when projection fails", () => {
  const make = createDirectSessionInitializationFactory({
    report: {},
    trace() {},
  });
  expect(() => make()).toThrow(
    "Complete consumed native world report fields required",
  );
  expect(() => make()).toThrow("Direct session initialization is one-use");
});
