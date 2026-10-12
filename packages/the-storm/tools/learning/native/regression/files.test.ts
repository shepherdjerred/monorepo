import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyOwned } from "./files.ts";

const directories: string[] = [];
async function directory() {
  const output = await mkdtemp(path.join(tmpdir(), "rwf-owned-verifier-"));
  directories.push(output);
  return output;
}
afterEach(async () => {
  for (const output of directories.splice(0))
    await rm(output, { recursive: true, force: true });
});

it("does not write a failure into a directory this attempt never owned", async () => {
  const output = await directory();
  const error = new Error("output already belongs to an original attempt");
  await expect(
    verifyOwned(output, { created: false }, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(await Bun.file(path.join(output, "failure.json")).exists()).toBe(
    false,
  );
});

it("seals an owned verification failure and keeps the original error", async () => {
  const output = await directory();
  const error = new Error("original recording changed");
  await expect(
    verifyOwned(output, { created: true }, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(await Bun.file(path.join(output, "failure.json")).json()).toEqual({
    schema: 1,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    error: error.message,
  });
});

it("never overwrites the first failure with a later verifier error", async () => {
  const output = await directory();
  const failure = path.join(output, "failure.json");
  const original = '{"error":"first capture failed"}\n';
  await Bun.write(failure, original);
  const error = new Error("later verification failed");
  await expect(
    verifyOwned(output, { created: true }, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(await Bun.file(failure).text()).toBe(original);
});
