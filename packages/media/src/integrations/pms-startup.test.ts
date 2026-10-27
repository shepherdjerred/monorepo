import { afterAll, expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pmsStartupErrors } from "#e2e/pms/startup-errors.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "media-pms-errors-"));
afterAll(() => rm(root, { recursive: true, force: true }));
async function capture(text: string) {
  const file = path.join(root, crypto.randomUUID());
  await writeFile(file, text);
  return pmsStartupErrors(file);
}
test("native fixture diagnostics retain only warnings/errors", async () => {
  expect(
    await capture(
      "INFO starting\nWARN agent offline\nERROR missing helper\nINFO stopping\n",
    ),
  ).toEqual(["WARN agent offline", "ERROR missing helper"]);
});
test("credential-bearing diagnostic lines are withheld", async () => {
  const names = [
    "token",
    "Authorization",
    "cookie",
    "password",
    "secret",
    "credential",
  ];
  expect(
    await capture(
      [
        ...names.map((name) => `ERROR ${name}=CANARY`),
        "ERROR https://invalid.example/?key=CANARY",
        "ERROR https://user:CANARY@invalid.example/",
        "WARN agent offline",
      ].join("\n"),
    ),
  ).toEqual(["WARN agent offline"]);
});
test("a partial tail line cannot lose its credential marker and become printable", async () => {
  expect(
    await capture(
      `ERROR password=${"x".repeat(80_000)} ERROR CANARY\nWARN safe complete line\n`,
    ),
  ).toEqual(["WARN safe complete line"]);
});
test("native fixture diagnostics retain at most sixteen bounded lines", async () => {
  const lines = Array.from(
    { length: 40 },
    (_, index) => `ERROR ${String(index)} ${"x".repeat(2000)}`,
  );
  const actual = await capture(lines.join("\n"));
  expect(actual).toHaveLength(16);
  expect(actual[0]?.startsWith("ERROR 24 ")).toBe(true);
  expect(actual.every((line) => line.length <= 1024)).toBe(true);
});
