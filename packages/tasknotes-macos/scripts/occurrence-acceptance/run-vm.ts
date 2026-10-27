import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { boundedCommand } from "../apple-acceptance/bounded-command.ts";
import { buildMacArtifact } from "../apple-acceptance/mac-journey.ts";
import {
  macFileSHA,
  macUUID,
  materializeMacArtifact,
  readMacArtifact,
  verifyMacArtifact,
} from "../apple-acceptance/mac-artifact.ts";
import {
  copyMacEvidence,
  publishMacEvidence,
} from "../apple-acceptance/mac-evidence.ts";
import {
  requireStableSources,
  sourceFingerprints,
} from "../apple-acceptance/source-provenance.ts";
import { occurrenceCommand, runPreparedMacOccurrence } from "./run-macos.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const share = "/Volumes/My Shared Files/exports";
const guestBun = "/Volumes/My Shared Files/tools/bun";
async function guest(
  exportID: string,
  expectedSHA: string,
  runID: string,
): Promise<void> {
  assert.match(exportID, macUUID);
  assert.match(runID, macUUID);
  assert.match(expectedSHA, /^[a-f0-9]{64}$/u);
  assert.equal(process.platform, "darwin");
  assert.ok(process.getuid && process.getuid() !== 0);
  const exportRoot = path.join(share, exportID),
    artifactFile = path.join(exportRoot, "artifact.json");
  const payloadFile = path.join(exportRoot, "payload.json");
  assert.equal(await macFileSHA(payloadFile), expectedSHA);
  const artifactSHA = await macFileSHA(artifactFile),
    bundleSHA = await macFileSHA(import.meta.path);
  assert.deepEqual(await Bun.file(payloadFile).json(), {
    schemaVersion: 1,
    artifactSHA256: artifactSHA,
    guestBundleSHA256: bundleSHA,
  });
  const artifact = readMacArtifact(await Bun.file(artifactFile).json());
  assert.equal(artifact.runID, exportID);
  assert.equal(await realpath(artifact.packageRoot), artifact.packageRoot);
  assert.equal((await lstat(artifact.packageRoot)).uid, process.getuid());
  const parent = path.join(
    artifact.packageRoot,
    ".build/occurrence-acceptance",
  );
  await mkdir(parent, { recursive: true });
  assert.equal(await realpath(parent), parent);
  const evidence = path.join(parent, runID);
  await mkdir(evidence, { recursive: false });
  const command = occurrenceCommand(artifact.packageRoot, evidence);
  assert.equal(
    await command(["/usr/sbin/sysctl", "-n", "kern.hv_vmm_present"], true),
    "1",
    "Guest replay cannot run on the host",
  );
  assert.equal(
    (await stat("/dev/console")).uid,
    process.getuid(),
    "Guest Agent must belong to the GUI user",
  );
  Bun.env["DEVELOPER_DIR"] = "/Applications/Xcode-beta.app/Contents/Developer";
  assert.equal(
    await command(["xcodebuild", "-version"], true),
    artifact.xcodeVersion,
  );
  const products = path.join(evidence, "macos/Build/Products"),
    errors: unknown[] = [];
  try {
    await mkdir(path.dirname(products), { recursive: true });
    await materializeMacArtifact(
      artifact,
      path.join(exportRoot, "products"),
      products,
    );
    const runtime = path.join(artifact.packageRoot, "scripts/apple-acceptance");
    await mkdir(runtime, { recursive: true });
    assert.equal(await realpath(runtime), runtime);
    const schema = path.join(runtime, "occurrence-launches.schema.json");
    if (!(await Bun.file(schema).exists()))
      await copyFile(
        path.join(exportRoot, "occurrence-launches.schema.json"),
        schema,
        1,
      );
    assert.ok(
      (await lstat(schema)).isFile() && !(await lstat(schema)).isSymbolicLink(),
    );
    assert.equal(
      await macFileSHA(schema),
      artifact.sources[
        "packages/tasknotes-macos/scripts/apple-acceptance/occurrence-launches.schema.json"
      ],
    );
    await runPreparedMacOccurrence({
      packageRoot: artifact.packageRoot,
      runID,
      sources: artifact.sources,
      provenance: {
        executionEnvironment: "headless-tart-guest",
        artifactBuildRunID: artifact.runID,
        sourceHead: artifact.sourceHead,
        artifactSHA256: artifactSHA,
        payloadSHA256: expectedSHA,
      },
      verifyInputs: async () => {
        assert.equal(await macFileSHA(import.meta.path), bundleSHA);
        assert.equal(await macFileSHA(payloadFile), expectedSHA);
        assert.equal(await macFileSHA(artifactFile), artifactSHA);
        for (const file of [
          "mac-process-owner.swift",
          "occurrence-launches.schema.json",
        ])
          assert.equal(
            await macFileSHA(path.join(exportRoot, file)),
            artifact.sources[
              `packages/tasknotes-macos/scripts/apple-acceptance/${file}`
            ],
          );
        await verifyMacArtifact(artifact, products, command);
      },
    });
  } catch (error) {
    errors.push(error);
    await Bun.write(
      path.join(evidence, "vm-error.json"),
      JSON.stringify({
        schemaVersion: 1,
        runID,
        status: "failed",
        message:
          error instanceof Error ? error.message : "Guest operation failed",
      }),
    );
  }
  await publishMacEvidence(evidence, runID);
  if (errors.length)
    throw new AggregateError(
      errors,
      "Guest recurrence failed; owned evidence retained",
    );
}

export async function runMacOccurrenceVM(vm: string): Promise<void> {
  assert.equal(process.platform, "darwin");
  assert.match(vm, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/u);
  const root = path.join(packageRoot, ".build/occurrence-vm"),
    buildID = crypto.randomUUID(),
    runID = crypto.randomUUID();
  const evidence = path.join(root, "builds", buildID),
    exported = path.join(root, "exports", buildID);
  await mkdir(path.dirname(evidence), { recursive: true });
  assert.equal(await realpath(root), root);
  assert.equal(await realpath(path.dirname(evidence)), path.dirname(evidence));
  await mkdir(evidence, { recursive: false });
  const command = occurrenceCommand(packageRoot, evidence);
  await command(["tart", "exec", vm, "/usr/bin/true"]); // Never create, start, download, or install a VM.
  const tools = path.join(root, "tools");
  await mkdir(tools, { recursive: true });
  assert.equal(await realpath(tools), tools);
  const bun = path.join(tools, "bun"),
    runtime = await realpath(process.execPath);
  if (!(await Bun.file(bun).exists())) {
    await copyFile(runtime, bun, 1);
    await chmod(bun, 0o755);
  }
  assert.equal(
    await macFileSHA(bun),
    await macFileSHA(runtime),
    "Provisioned Bun changed; update the owned tools share explicitly",
  );
  assert.equal(
    await command(["tart", "exec", vm, guestBun, "--version"], true),
    Bun.version,
  );
  const artifact = await buildMacArtifact(packageRoot, evidence, command);
  const checkSources = async () => {
    const workspace = path.resolve(packageRoot, "../..");
    requireStableSources(
      artifact.sources,
      await sourceFingerprints(workspace, (argv) =>
        command(argv, true, workspace),
      ),
    );
    assert.equal(
      await command(["git", "rev-parse", "HEAD"], true, workspace),
      artifact.sourceHead,
    );
  };
  await mkdir(path.dirname(exported), { recursive: true });
  await mkdir(exported, { recursive: false });
  await materializeMacArtifact(
    artifact,
    path.join(evidence, "macos/Build/Products"),
    path.join(exported, "products"),
  );
  await Bun.write(
    path.join(exported, "artifact.json"),
    JSON.stringify(artifact),
  );
  for (const file of [
    "mac-process-owner.swift",
    "occurrence-launches.schema.json",
  ]) {
    const source = path.join(packageRoot, "scripts/apple-acceptance", file);
    assert.equal(
      await macFileSHA(source),
      artifact.sources[
        `packages/tasknotes-macos/scripts/apple-acceptance/${file}`
      ],
    );
    await copyFile(source, path.join(exported, file), 1);
  }
  const bundle = await Bun.build({
    entrypoints: [import.meta.path],
    outdir: exported,
    naming: "guest.js",
    target: "bun",
  });
  assert.ok(bundle.success, "Guest bundling failed");
  const bundleSHA = await macFileSHA(path.join(exported, "guest.js"));
  const payload = path.join(exported, "payload.json");
  await Bun.write(
    payload,
    JSON.stringify({
      schemaVersion: 1,
      artifactSHA256: await macFileSHA(path.join(exported, "artifact.json")),
      guestBundleSHA256: bundleSHA,
    }),
  );
  const manifestSHA = await macFileSHA(payload);
  assert.equal(
    await command(
      [
        "tart",
        "exec",
        vm,
        guestBun,
        "-e",
        "console.log(new Bun.CryptoHasher('sha256').update(await Bun.file(process.argv[1]).bytes()).digest('hex'))",
        path.join(share, buildID, "payload.json"),
      ],
      true,
    ),
    manifestSHA,
    "VM must mount this persistent readonly harness share",
  );
  await checkSources();
  const failures: unknown[] = [];
  let blocked = false;
  try {
    // Transport includes setup and retirement; inner XCTest stays180/240 seconds.
    await boundedCommand(
      [
        "tart",
        "exec",
        vm,
        guestBun,
        path.join(share, buildID, "guest.js"),
        "--guest",
        buildID,
        manifestSHA,
        runID,
      ],
      {
        cwd: packageRoot,
        logs: path.join(evidence, "guest-exec"),
        timeoutMS: 420_000,
      },
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    const guestEvidence = path.join(
      packageRoot,
      ".build/occurrence-acceptance",
      runID,
    );
    const metadata: unknown = JSON.parse(
      await command(
        [
          "tart",
          "exec",
          vm,
          "/bin/cat",
          path.join(guestEvidence, "transport.json"),
        ],
        true,
      ),
    );
    const restored = await copyMacEvidence({
      vm,
      runID,
      guestEvidence,
      evidence,
      metadata,
      packageRoot,
    });
    const outcome: unknown = await Bun.file(
      path.join(restored, "run.json"),
    ).json();
    assert.ok(outcome !== null && typeof outcome === "object");
    assert.equal(Reflect.get(outcome, "runID"), runID);
    blocked = Reflect.get(outcome, "status") === "blocked";
    assert.equal(Reflect.get(outcome, "status"), "passed");
  } catch (error) {
    failures.push(error);
  }
  await checkSources();
  assert.equal(await macFileSHA(path.join(exported, "guest.js")), bundleSHA);
  assert.equal(await macFileSHA(payload), manifestSHA);
  await Bun.write(
    path.join(evidence, "vm-outcome.json"),
    JSON.stringify({
      schemaVersion: 1,
      vm,
      buildID,
      runID,
      sourceHead: artifact.sourceHead,
      status: blocked ? "blocked" : failures.length ? "failed" : "passed",
    }),
  );
  if (failures.length)
    throw new AggregateError(
      failures,
      `VM recurrence failed; retained ${evidence}`,
    );
  console.log(`VM recurrence passed: ${evidence}`);
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: bun run mac:occurrences:e2e --vm <running-preprovisioned-VM>",
    );
  } else if (args[0] === "--guest" && args.length === 4) {
    const [, exported, sha, run] = args;
    assert.ok(exported && sha && run);
    await guest(exported, sha, run);
  } else {
    assert.equal(
      args.length,
      2,
      "Usage: bun run mac:occurrences:e2e --vm <running-preprovisioned-VM>",
    );
    assert.equal(args[0], "--vm");
    const vm = args[1];
    assert.ok(vm);
    await runMacOccurrenceVM(vm);
  }
}
