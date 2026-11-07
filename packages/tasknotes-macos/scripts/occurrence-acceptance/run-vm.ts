import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  realpath,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { boundedCommand } from "../apple-acceptance/bounded-command.ts";
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
  loadMacVMExport,
  persistMacVMCaptureReady,
  prepareMacVMExport,
  readOwnedMacVMJSON,
  recordUnstartedMacVM,
  requireCurrentMacVMSources,
  requireMacVMCaptureReady,
} from "../apple-acceptance/mac-vm-export.ts";
import { installMacVMRunner } from "../apple-acceptance/mac-vm-runner.ts";
import {
  macAcceptancePlan,
  occurrenceCommand,
  runPreparedMacOccurrence,
  type MacAcceptanceMode,
} from "./run-macos.ts";
import { runAcceptanceUiTests } from "../run-acceptance-ui-tests.ts";
import { standaloneTests } from "../acceptance-test-plan.ts";
import { retireMacRun } from "../apple-acceptance/native-owner.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");
const share = "/Volumes/My Shared Files/exports";
const guestBun = "/Volumes/My Shared Files/tools/bun";
const usage =
  "Usage: mac:occurrences:e2e --vm <running-VM> (--prepare | --artifact-build <UUID> [--setup-capture | --standalone])";
type VMMode = MacAcceptanceMode | "standalone";
type VMOperation = { vm: string; buildID?: string; mode: VMMode };

export function macVMPlan(mode: VMMode) {
  return mode === "standalone"
    ? { kind: "native-local-macos", successStatus: "passed" as const }
    : macAcceptancePlan(mode);
}

export function parseMacVMArguments(args: string[]): VMOperation {
  assert.ok(args.length >= 3 && args[0] === "--vm", usage);
  const vm = args[1];
  assert.ok(vm && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/u.test(vm), usage);
  if (args.length === 3 && args[2] === "--prepare")
    return { vm, mode: "recurrence" };
  assert.ok(
    (args.length === 4 || args.length === 5) && args[2] === "--artifact-build",
    usage,
  );
  const buildID = args[3];
  assert.ok(buildID && macUUID.test(buildID), usage);
  if (args.length === 5)
    assert.ok(
      args[4] === "--setup-capture" || args[4] === "--standalone",
      usage,
    );
  return {
    vm,
    buildID,
    mode:
      args[4] === "--standalone"
        ? "standalone"
        : args.length === 5
          ? "capture-readiness"
          : "recurrence",
  };
}

async function guest(
  exportID: string,
  expectedSHA: string,
  runID: string,
  mode: VMMode,
): Promise<void> {
  assert.match(exportID, macUUID);
  assert.match(runID, macUUID);
  assert.match(expectedSHA, /^[a-f0-9]{64}$/u);
  const plan = macVMPlan(mode);
  assert.equal(process.platform, "darwin");
  assert.ok(process.getuid && process.getuid() !== 0);
  const exportRoot = path.join(share, exportID),
    artifactFile = path.join(exportRoot, "artifact.json"),
    payloadFile = path.join(exportRoot, "payload.json");
  assert.equal(await macFileSHA(payloadFile), expectedSHA);
  const artifactSHA = await macFileSHA(artifactFile),
    bundleSHA = await macFileSHA(import.meta.path);
  assert.deepEqual(await readOwnedMacVMJSON(payloadFile), {
    schemaVersion: 1,
    artifactSHA256: artifactSHA,
    guestBundleSHA256: bundleSHA,
  });
  const artifact = readMacArtifact(await readOwnedMacVMJSON(artifactFile));
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
  let installed: Awaited<ReturnType<typeof installMacVMRunner>> | undefined;
  try {
    await mkdir(path.dirname(products), { recursive: true });
    await materializeMacArtifact(
      artifact,
      path.join(exportRoot, "products"),
      products,
    );
    installed = await installMacVMRunner(
      artifact,
      path.join(exportRoot, "products"),
      runID,
      command,
    );
    const installedRunner = installed;
    const expectedReady = {
      payloadSHA256: expectedSHA,
      installationID: installedRunner.installationID,
      bundlePath: installedRunner.bundlePath,
      sourceHead: artifact.sourceHead,
    };
    const readyRoot = path.join(
      homedir(),
      "Library/Application Support/FacetAcceptanceHarness/readiness",
    );
    await mkdir(readyRoot, { recursive: true });
    assert.equal(await realpath(readyRoot), readyRoot);
    const readyDirectory = await lstat(readyRoot);
    assert.ok(
      readyDirectory.isDirectory() &&
        readyDirectory.uid === process.getuid?.() &&
        (readyDirectory.mode & 0o022) === 0,
    );
    const readyFile = path.join(
      readyRoot,
      `${expectedSHA}-${installedRunner.installationID}.json`,
    );
    if (mode !== "capture-readiness") {
      assert.ok(
        await Bun.file(readyFile).exists(),
        "Run --setup-capture with this exact artifact first",
      );
      requireMacVMCaptureReady(
        await readOwnedMacVMJSON(readyFile, 4096),
        expectedReady,
      );
    } else
      await command([
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        "-f",
        installedRunner.bundlePath,
      ]);
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
    const verifyInputs = async () => {
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
      for (const file of [
        "Tasks/Existing.md",
        "Reference.md",
        "tasknotes.yaml",
      ])
        assert.equal(
          await macFileSHA(path.join(exportRoot, "local-vault", file)),
          artifact.sources[
            `packages/tasknotes-fixtures/e2e/local-vault/${file}`
          ],
        );
      await verifyMacArtifact(artifact, products, command);
      await installedRunner.verify();
    };
    const provenance = {
      executionEnvironment: "headless-tart-guest",
      artifactBuildRunID: artifact.runID,
      sourceHead: artifact.sourceHead,
      artifactSHA256: artifactSHA,
      payloadSHA256: expectedSHA,
      runnerInstallationID: installedRunner.installationID,
      runnerBundlePath: installedRunner.bundlePath,
    };
    if (mode === "standalone") {
      const standaloneFailures: unknown[] = [];
      try {
        await runAcceptanceUiTests(standaloneTests, {
          prepared: {
            runID,
            evidence,
            derived: path.join(evidence, "macos"),
            fixture: path.join(exportRoot, "local-vault"),
            runnerBundlePath: installedRunner.bundlePath,
            command,
            verifyInputs,
            provenance,
          },
        });
      } catch (error) {
        standaloneFailures.push(error);
      }
      try {
        const binding = {
          runID,
          descriptor: path.join(
            homedir(),
            "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data/Library/Application Support/FacetAcceptance",
            runID,
            "acceptance.json",
          ),
          executable: path.join(
            products,
            "Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
          ),
        };
        // Ordinary XCTest teardown owns termination. Without a retained launch
        // authority, this proves absence and rejects any remaining process.
        const retired = await retireMacRun(binding, null, evidence);
        await Bun.write(
          path.join(evidence, "ownership-cleanup.json"),
          JSON.stringify({
            schemaVersion: 1,
            ...binding,
            journalPresent: false,
            ...retired,
          }),
        );
      } catch (error) {
        standaloneFailures.push(error);
      }
      if (standaloneFailures.length)
        throw new AggregateError(
          standaloneFailures,
          "Standalone guest acceptance or process retirement failed",
        );
    } else
      await runPreparedMacOccurrence({
        packageRoot: artifact.packageRoot,
        runID,
        sources: artifact.sources,
        mode,
        runnerBundlePath: installedRunner.bundlePath,
        provenance,
        verifyInputs,
      });
    if (mode === "capture-readiness")
      await persistMacVMCaptureReady(readyFile, expectedReady, runID);
    assert.equal(
      (await Bun.file(path.join(evidence, "run.json")).json()).status,
      plan.successStatus,
    );
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
    const state = path.join(
      homedir(),
      "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data/Library/Application Support/FacetAcceptance",
      runID,
    );
    if (
      !(await Bun.file(path.join(evidence, "run.json")).exists()) &&
      !(await Bun.file(
        path.join(evidence, "ownership-cleanup.json"),
      ).exists()) &&
      !(await Bun.file(path.join(state, "occurrence-launches.json")).exists())
    ) {
      try {
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
        await recordUnstartedMacVM(
          {
            runID,
            descriptor: path.join(state, "acceptance.json"),
            executable: path.join(
              products,
              "Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
            ),
          },
          evidence,
        );
        await Bun.write(
          path.join(evidence, "run.json"),
          JSON.stringify({
            schemaVersion: 1,
            runID,
            kind: plan.kind,
            status: "failed",
            sourceHead: artifact.sourceHead,
            nativeTestStarted: false,
          }),
        );
      } catch (cleanup) {
        errors.push(cleanup);
      }
    }
  } finally {
    if (installed)
      try {
        await installed.release();
      } catch (error) {
        errors.push(error);
      }
  }
  try {
    await publishMacEvidence(evidence, runID);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "Guest operation failed; owned evidence retained",
    );
}

export async function runMacOccurrenceVM(
  operation: VMOperation,
): Promise<void> {
  assert.equal(process.platform, "darwin");
  const { vm, mode } = operation;
  const root = path.join(packageRoot, ".build/occurrence-vm"),
    operationID = crypto.randomUUID();
  const preparing = operation.buildID === undefined;
  const evidence = path.join(
    root,
    preparing ? "builds" : "replays",
    operationID,
  );
  await mkdir(path.dirname(evidence), { recursive: true });
  assert.equal(await realpath(root), root);
  assert.equal(await realpath(path.dirname(evidence)), path.dirname(evidence));
  await mkdir(evidence, { recursive: false });
  const command = occurrenceCommand(packageRoot, evidence);
  await command(["tart", "exec", vm, "/usr/bin/true"]); // Existing guest only; never provision or start one.
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
  const exported = preparing
    ? await prepareMacVMExport(packageRoot, operationID, command)
    : await loadMacVMExport(packageRoot, operation.buildID ?? "", command);
  const { artifact, payloadSHA256 } = exported;
  if (preparing) {
    console.log(
      JSON.stringify({
        status: "prepared",
        buildID: artifact.runID,
        sourceHead: artifact.sourceHead,
        payloadSHA256,
        testsRun: 0,
        nativeTestStarted: false,
      }),
    );
    return;
  }
  assert.equal(
    await command(
      [
        "tart",
        "exec",
        vm,
        guestBun,
        "-e",
        "console.log(new Bun.CryptoHasher('sha256').update(await Bun.file(process.argv[1]).bytes()).digest('hex'))",
        path.join(share, artifact.runID, "payload.json"),
      ],
      true,
    ),
    payloadSHA256,
    "VM must mount this persistent readonly export",
  );
  const runID = crypto.randomUUID(),
    failures: unknown[] = [];
  let blocked = false;
  const plan = macVMPlan(mode);
  try {
    await boundedCommand(
      [
        "tart",
        "exec",
        vm,
        guestBun,
        path.join(share, artifact.runID, "guest.js"),
        "--guest",
        artifact.runID,
        payloadSHA256,
        runID,
        mode,
      ],
      {
        cwd: packageRoot,
        logs: path.join(evidence, "guest-exec"),
        timeoutMS: mode === "standalone" ? 1_260_000 : 420_000,
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
          "--",
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
    assert.equal(Reflect.get(outcome, "kind"), plan.kind);
    blocked = Reflect.get(outcome, "status") === "blocked";
    assert.equal(Reflect.get(outcome, "status"), plan.successStatus);
  } catch (error) {
    failures.push(error);
  }
  await requireCurrentMacVMSources(artifact, command);
  assert.equal(
    (await loadMacVMExport(packageRoot, artifact.runID, command)).payloadSHA256,
    payloadSHA256,
  );
  await Bun.write(
    path.join(evidence, "vm-outcome.json"),
    JSON.stringify({
      schemaVersion: 1,
      vm,
      buildID: artifact.runID,
      operationID,
      runID,
      sourceHead: artifact.sourceHead,
      mode,
      status: blocked
        ? "blocked"
        : failures.length
          ? "failed"
          : plan.successStatus,
    }),
  );
  if (failures.length)
    throw new AggregateError(
      failures,
      `VM operation failed; retained ${evidence}`,
    );
  console.log(`VM ${plan.successStatus}: ${evidence}`);
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") console.log(usage);
  else if (args[0] === "--guest" && args.length === 5) {
    const [, exported, sha, run, mode] = args;
    assert.ok(
      exported &&
        sha &&
        run &&
        (mode === "recurrence" ||
          mode === "capture-readiness" ||
          mode === "standalone"),
    );
    await guest(exported, sha, run, mode);
  } else await runMacOccurrenceVM(parseMacVMArguments(args));
}
