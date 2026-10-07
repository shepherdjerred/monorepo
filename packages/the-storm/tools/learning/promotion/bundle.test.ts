import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareBundle } from "./bundle.ts";
import { RegressionEvidence } from "./contract.ts";
import { hashFile } from "./archive.ts";
import { collectionFixture } from "./test-support/collection-fixture.ts";
import { PilotLedger } from "#learning/pilot-ledger.ts";
import { sha, readJson, jsonText } from "#learning/preference/ledger.ts";
import { z } from "zod";

// Only dataset/numerical boundaries are mocked. Java sealing is not invoked;
// every output here remains unaccepted. Real numerical replay has independent Python/JNI tests.
vi.mock("#learning/preference/media.ts", () => ({
  run: async (command: string[]) => {
    const helper = await import("./test-support/collection-fixture.ts");
    return helper.datasetBoundary(command);
  },
}));
let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(
    path.join(os.tmpdir(), "rwf-promotion-collection-"),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("assembles portable original evidence while leaving the manifest unaccepted", async () => {
  const request = await collectionFixture(directory);
  const original = await readFile(path.join(request.model, "manifest.json"));
  const proof = await prepareBundle(request);
  expect(proof.preference.learned_votes).toBe(15);
  expect(proof.pilot.seeds.map((seed) => seed.seed)).toEqual([11, 12, 13]);
  expect(proof.load.phases.map((phase) => phase.bots)).toEqual([20, 50, 100]);
  expect(proof.load.phases.map((phase) => phase.maximum_batch)).toEqual([
    20, 50, 100,
  ]);
  for (const file of proof.files) {
    expect(file.file).toBe(`evidence/${file.sha256}.blob`);
    expect(await hashFile(path.join(request.output, file.file))).toBe(
      file.sha256,
    );
  }
  expect(
    await readFile(path.join(request.output, "source-manifest.json")),
  ).toEqual(original);
  expect(await readFile(path.join(request.model, "manifest.json"))).toEqual(
    original,
  );
  await expect(
    readFile(path.join(request.output, "manifest.json")),
  ).rejects.toThrow();
  await expect(prepareBundle(request)).rejects.toThrow();
  expect(await readJson(path.join(request.output, "promotion.json"))).toEqual(
    proof,
  );
});

it("a failed original human ballot cannot be replaced by a promotion claim", async () => {
  const request = await collectionFixture(directory, 14);
  await expect(prepareBundle(request)).rejects.toThrow(
    "original passing human review",
  );
  await expect(
    readFile(path.join(request.output, "collection.json")),
  ).rejects.toThrow();
});

it("an edited load summary cannot override its original raw command stream", async () => {
  const request = await collectionFixture(directory);
  const file = path.join(request.load, "verification.json");
  const original = z
    .record(z.string(), z.unknown())
    .parse(await readJson(file));
  await writeFile(
    file,
    jsonText({ ...original, pass: true, baseline: { ticks: 1800, p95: 1 } }),
  );
  await expect(prepareBundle(request)).rejects.toThrow(
    "differs from the original full command stream",
  );
  await expect(
    readFile(path.join(request.output, "manifest.json")),
  ).rejects.toThrow();
});

it("rejects changed original frozen weights before archiving evidence", async () => {
  const request = await collectionFixture(directory);
  await writeFile(
    path.join(request.pilot, "seed-0/learning/final/weights.pt"),
    "changed original checkpoint",
  );
  await expect(prepareBundle(request)).rejects.toThrow(
    "frozen pilot evidence changed",
  );
  await expect(
    readFile(path.join(request.output, "collection.json")),
  ).rejects.toThrow();
});

it("rejects a regression receipt with skipped required checks", async () => {
  const request = await collectionFixture(directory);
  const evidence = RegressionEvidence.parse(
    await readJson(request.regressions),
  );
  const first = evidence.cases[0];
  if (first === undefined) throw new Error("required regression case missing");
  await writeFile(
    request.regressions,
    jsonText({
      ...evidence,
      cases: [{ ...first, skipped: 1 }, ...evidence.cases.slice(1)],
    }),
  );
  await expect(prepareBundle(request)).rejects.toThrow();
  await expect(
    readFile(path.join(request.output, "manifest.json")),
  ).rejects.toThrow();
});

it("the real CLI rejects diagnostic pilots before creating output", async () => {
  const pilot = path.join(directory, "diagnostic");
  await PilotLedger.create(pilot, {
    version: 1,
    mode: "diagnostic",
    acceptance: "unaccepted",
    seeds: [1, 2, 3],
    seconds: 300,
    device: "cpu",
    dataset: null,
    inputSha256: sha("unit diagnostic"),
  });
  const options = [
    "evaluation",
    "model",
    "review",
    "parity",
    "receipt",
    "load",
    "regressions",
    "output",
  ];
  const args = options.flatMap((name) => [
    `--${name}`,
    path.join(directory, name),
  ]);
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dirname, "index.ts"),
      "--pilot",
      pilot,
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).not.toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain(
    "diagnostic pilots cannot establish human preference acceptance",
  );
  await expect(
    readFile(path.join(directory, "output/manifest.json")),
  ).rejects.toThrow();
});
