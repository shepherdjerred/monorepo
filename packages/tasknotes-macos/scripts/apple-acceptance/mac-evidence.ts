import assert from "node:assert/strict";
import { lstat, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { boundedCommand } from "./bounded-command.ts";
import { macFileSHA, safeMacRelative } from "./mac-artifact.ts";

const maximumTotalBytes = 256 * 1024 * 1024;
const maximumFileBytes = 64 * 1024 * 1024;
const evidenceRoots = new Set([
  "Occurrence.xcresult",
  "screenshots",
  "state",
  "commands",
  "cleanup-commands",
]);
const evidenceFiles = new Set([
  "run.json",
  "summary.json",
  "tests.json",
  "ownership-cleanup.json",
  "session-preflight.json",
  "vm-error.json",
]);
type EvidenceFile = { path: string; bytes: number; sha256: string };

function allowedMacEvidencePath(file: string): boolean {
  safeMacRelative(file);
  const first = file.split("/")[0];
  return (
    (first !== undefined && evidenceRoots.has(first) && file.includes("/")) ||
    evidenceFiles.has(file)
  );
}
export function readMacEvidence(raw: unknown, runID: string): EvidenceFile[] {
  assert.ok(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  assert.deepEqual(Object.keys(raw).sort(), [
    "files",
    "runID",
    "schemaVersion",
  ]);
  assert.equal(Reflect.get(raw, "schemaVersion"), 1);
  assert.equal(Reflect.get(raw, "runID"), runID);
  const entries: unknown = Reflect.get(raw, "files");
  assert.ok(
    Array.isArray(entries) && entries.length > 0 && entries.length <= 20_000,
  );
  let total = 0;
  const paths = new Set<string>();
  const files = entries.map((entry: unknown) => {
    assert.ok(entry !== null && typeof entry === "object");
    assert.deepEqual(Object.keys(entry).sort(), ["bytes", "path", "sha256"]);
    const file: unknown = Reflect.get(entry, "path"),
      bytes: unknown = Reflect.get(entry, "bytes"),
      sha256: unknown = Reflect.get(entry, "sha256");
    assert.ok(
      typeof file === "string" &&
        allowedMacEvidencePath(file) &&
        !paths.has(file),
    );
    assert.ok(
      typeof bytes === "number" &&
        Number.isSafeInteger(bytes) &&
        bytes >= 0 &&
        bytes <= maximumFileBytes,
    );
    assert.ok(typeof sha256 === "string" && /^[a-f0-9]{64}$/u.test(sha256));
    paths.add(file);
    total += bytes;
    assert.ok(total <= maximumTotalBytes);
    return { path: file, bytes, sha256 };
  });
  for (const file of paths)
    for (
      let parent = path.posix.dirname(file);
      parent !== ".";
      parent = path.posix.dirname(parent)
    )
      assert.ok(!paths.has(parent), "Evidence file/directory collision");
  return files;
}
/** Publish only after the normal journal/owner retirement boundary has completed. */
export async function publishMacEvidence(
  evidence: string,
  runID: string,
): Promise<void> {
  const cleanup: unknown = await Bun.file(
    path.join(evidence, "ownership-cleanup.json"),
  ).json();
  assert.ok(cleanup !== null && typeof cleanup === "object");
  assert.equal(Reflect.get(cleanup, "runID"), runID);
  assert.equal(
    Reflect.get(cleanup, "observedExit"),
    true,
    "Results require retired owned app",
  );
  const files: EvidenceFile[] = [];
  for await (const file of new Bun.Glob("**/*").scan({
    cwd: evidence,
    onlyFiles: false,
    dot: true,
  })) {
    if (!allowedMacEvidencePath(file)) continue;
    const target = path.join(evidence, file),
      metadata = await lstat(target);
    assert.ok(!metadata.isSymbolicLink(), "Evidence transport rejects links");
    if (metadata.isDirectory()) continue;
    assert.ok(metadata.isFile() && metadata.uid === process.getuid?.());
    files.push({
      path: file,
      bytes: metadata.size,
      sha256: await macFileSHA(target),
    });
  }
  const manifest = { schemaVersion: 1, runID, files };
  readMacEvidence(manifest, runID);
  await Bun.write(
    path.join(evidence, "transport.json"),
    JSON.stringify(manifest),
  );
}
/** Three bounded binary copies; stderr stays in separate command logs. */
export async function copyMacEvidence(options: {
  vm: string;
  runID: string;
  guestEvidence: string;
  evidence: string;
  metadata: unknown;
  packageRoot: string;
}): Promise<string> {
  const pending = readMacEvidence(options.metadata, options.runID);
  const restored = path.join(options.evidence, "guest");
  await mkdir(restored, { recursive: false });
  const transfers = await Promise.allSettled(
    Array.from({ length: 3 }, async () => {
      while (pending.length) {
        const file = pending.pop();
        assert.ok(file);
        const output = path.join(restored, file.path);
        await mkdir(path.dirname(output), { recursive: true });
        await boundedCommand(
          [
            "tart",
            "exec",
            options.vm,
            "/bin/cat",
            "--",
            path.join(options.guestEvidence, file.path),
          ],
          {
            cwd: options.packageRoot,
            logs: path.join(options.evidence, "transfer-commands"),
            timeoutMS: 60_000,
            outputFile: { path: output, maximumBytes: file.bytes },
          },
        );
        assert.equal((await stat(output)).size, file.bytes);
        assert.equal(await macFileSHA(output), file.sha256);
      }
    }),
  );
  const failures = transfers.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length)
    throw new AggregateError(
      failures,
      "Evidence transfer failed; partial files retained",
    );
  return restored;
}
