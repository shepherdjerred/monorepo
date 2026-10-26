import { afterEach, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CorpusManifestSchema, CorpusLabelsSchema } from "./contract.ts";
import { CorpusReportSchema } from "./report.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "media-corpus-cli-"));
  directories.push(directory);
  await cp(
    fileURLToPath(new URL("seeds", import.meta.url)),
    path.join(directory, "seeds"),
    { recursive: true },
  );
  return {
    directory,
    manifest: path.join(directory, "seeds/manifest.json"),
    report: path.join(directory, "report.json"),
  };
}
async function command(manifest: string, output: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        "bun",
        [
          "--no-install",
          "scripts/corpus/replay.ts",
          "--manifest",
          manifest,
          "--output",
          output,
        ],
        {
          cwd: packageRoot,
          stdio: ["ignore", "pipe", "pipe"],
          signal: AbortSignal.timeout(3000),
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.setEncoding("utf8").on("data", (value: string) => {
        stdout += value;
      });
      child.stderr.setEncoding("utf8").on("data", (value: string) => {
        stderr += value;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    },
  );
}

test("actual local corpus CLI writes a labelled report and refuses to overwrite it", async () => {
  const f = await fixture();
  const first = await command(f.manifest, f.report);
  expect(first, first.stderr).toMatchObject({ code: 0 });
  const original = await readFile(f.report, "utf8");
  const report = CorpusReportSchema.parse(JSON.parse(original));
  expect(report).toMatchObject({
    passed: true,
    counts: { cases: 3, synthetic: 3, captured: 0 },
  });
  expect(first.stdout).toContain('"passed":true');
  const second = await command(f.manifest, f.report);
  expect(second.code).not.toBe(0);
  expect(second.stderr).toContain("EEXIST");
  expect(await readFile(f.report, "utf8")).toBe(original);
});

test("actual CLI returns nonzero with an explicit wrong-accept report for conflicting independent labels", async () => {
  const f = await fixture();
  const manifest = CorpusManifestSchema.parse(
    JSON.parse(await readFile(f.manifest, "utf8")),
  );
  const entry = manifest.cases[0];
  if (entry === undefined) throw new Error("Authored case missing");
  const filename = path.join(path.dirname(f.manifest), entry.labels.path);
  const labels = CorpusLabelsSchema.parse(
    JSON.parse(await readFile(filename, "utf8")),
  );
  const web = labels.candidates.find((value) => value.key === "web");
  if (web === undefined) throw new Error("Authored known positive missing");
  web.disposition = "reject";
  const bytes = JSON.stringify(labels);
  await writeFile(filename, bytes);
  entry.labels.sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(f.manifest, JSON.stringify(manifest));
  const result = await command(f.manifest, f.report);
  expect(result.code).toBe(1);
  const report = CorpusReportSchema.parse(
    JSON.parse(await readFile(f.report, "utf8")),
  );
  expect(report.passed).toBe(false);
  expect(report.counts.wrongAccept).toBeGreaterThan(0);
});
