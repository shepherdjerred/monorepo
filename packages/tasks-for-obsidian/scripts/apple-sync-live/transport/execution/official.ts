import assert from "node:assert/strict";
import { copyFile, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GuestRequest } from "../contract.ts";
import { contentSHA } from "../fields.ts";
import { inspectOwnedMacProcesses } from "../../mac-process-inspection.ts";
import {
  inspectOfficialPlugin,
  officialPluginAssets,
} from "../../official-plugin.ts";
import {
  assertOfficialRemoteVersion,
  officialHistoryHead,
  validateOfficialScreenshot,
} from "../../official-artifact.ts";
import type { ExecutionOperation, ExecutionResult } from "./contract.ts";
import type { GuestRuntime } from "./runtime.ts";
import { registerOfficialReference } from "./official-registry.ts";
import { parseOfficialEvalBoolean } from "./official-read.ts";

export async function officialRead(
  runtime: GuestRuntime,
  argv: string[],
  maximumMS = 10_000,
): Promise<Uint8Array> {
  const executable = path.join(
    runtime.paths.officialApp,
    "Contents/MacOS/Obsidian",
  );
  const owners = await inspectOwnedMacProcesses(executable, 5000);
  assert.equal(
    owners.length,
    1,
    "Exactly the owned signed official app must be running",
  );
  const cli = path.join(
    runtime.paths.officialApp,
    "Contents/MacOS/obsidian-cli",
  );
  const environment: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "USER", "LOGNAME"])
    if (Bun.env[key] !== undefined) environment[key] = Bun.env[key];
  // Official CLI uses its CWD as the supported vault selector. No output becomes a command log.
  const read = async (args: string[]) => {
    const { boundedOfficialRead } = await import("./official-read.ts");
    return boundedOfficialRead({
      cli,
      args,
      cwd: runtime.paths.referenceDirectory,
      environment,
      timeoutMS: maximumMS,
    });
  };
  assert.equal(
    new TextDecoder().decode(await read(["vault", "info=path"])).trim(),
    runtime.paths.referenceDirectory,
  );
  const output = await read(argv);
  assert.equal(
    new TextDecoder().decode(await read(["vault", "info=path"])).trim(),
    runtime.paths.referenceDirectory,
  );
  return output;
}
type OfficialOperation = Extract<
  ExecutionOperation,
  {
    kind:
      | "official-launch"
      | "official-plugin"
      | "official-info"
      | "official-step"
      | "official-publication";
  }
>;
async function installOfficialPlugin(
  runtime: GuestRuntime,
  operation: Extract<OfficialOperation, { kind: "official-plugin" }>,
): Promise<ExecutionResult> {
  const source = path.join(
    "/Volumes/My Shared Files/exports",
    `official-tasknotes-${operation.exportID}`,
  );
  assert.equal(await realpath(source), source);
  const destination = path.join(
    runtime.paths.referenceDirectory,
    ".obsidian/plugins/tasknotes",
  );
  await mkdir(destination, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(destination), destination);
  for (const [name, expected] of Object.entries(officialPluginAssets)) {
    const original = path.join(source, name),
      metadata = await lstat(original);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    assert.equal(metadata.size, expected.size);
    assert.equal(contentSHA(await readFile(original)), expected.sha256);
    const target = path.join(destination, name);
    if (await Bun.file(target).exists()) {
      const current = await lstat(target);
      assert.ok(
        current.isFile() &&
          !current.isSymbolicLink() &&
          current.uid === process.getuid?.(),
      );
      assert.equal(contentSHA(await readFile(target)), expected.sha256);
    } else await copyFile(original, target, 1);
  }
  await inspectOfficialPlugin(destination);
  return { kind: "official-plugin", version: "4.13.8" };
}
export async function runGuestOfficial(
  runtime: GuestRuntime,
  operation: OfficialOperation,
  request: GuestRequest,
): Promise<ExecutionResult> {
  if (operation.kind === "official-plugin")
    return installOfficialPlugin(runtime, operation);
  if (operation.kind === "official-launch") {
    const owners = await inspectOwnedMacProcesses(
      path.join(runtime.paths.officialApp, "Contents/MacOS/Obsidian"),
      5000,
    );
    assert.equal(
      owners.length,
      0,
      "Inspect an already-running official app rather than opening another window",
    );
    await registerOfficialReference(runtime);
    await runtime.command(["open", "-n", runtime.paths.officialApp]);
    await waitOfficialReference(runtime);
    return { kind: "official-launch", launched: true };
  }
  if (operation.kind === "official-info") {
    const pluginDirectory = path.join(
      runtime.paths.referenceDirectory,
      ".obsidian/plugins/tasknotes",
    );
    const pluginEvidence = await inspectOfficialPlugin(pluginDirectory);
    return {
      kind: "official-info",
      officialVersion: runtime.config.officialApp.version,
      pluginManifestSHA256: contentSHA(
        await readFile(path.join(pluginDirectory, "manifest.json")),
      ),
      pluginEvidence,
    };
  }
  return operation.kind === "official-publication"
    ? verifyPublication(runtime, operation)
    : captureOfficialStep(runtime, operation, request);
}
async function waitOfficialReference(runtime: GuestRuntime): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await officialRead(
        runtime,
        ["vault", "info=path"],
        Math.min(5000, Math.max(1, deadline - Date.now())),
      );
      return;
    } catch {
      assert.ok(
        Date.now() < deadline,
        "Official registered reference did not open within its deadline",
      );
      await Bun.sleep(100);
    }
  }
}
async function verifyPublication(
  runtime: GuestRuntime,
  operation: Extract<OfficialOperation, { kind: "official-publication" }>,
): Promise<ExecutionResult> {
  assert.ok(
    operation.relative.startsWith("Tasks/"),
    "Remote publication reads are confined to synthetic tasks",
  );
  const expected = Buffer.from(operation.expectedBytes, "base64");
  assert.equal(expected.toString("base64"), operation.expectedBytes);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const read = (args: string[]) =>
        officialRead(
          runtime,
          args,
          Math.max(1, Math.min(10_000, deadline - Date.now())),
        );
      const head = officialHistoryHead(
        new TextDecoder().decode(
          await read(["sync:history", `path=${operation.relative}`]),
        ),
      );
      const fingerprint = assertOfficialRemoteVersion(
        await read([
          "sync:read",
          `path=${operation.relative}`,
          `version=${String(head.version)}`,
        ]),
        operation.relative,
        head,
        expected,
      );
      const after = officialHistoryHead(
        new TextDecoder().decode(
          await read(["sync:history", `path=${operation.relative}`]),
        ),
      );
      assert.deepEqual(after, head);
      assert.ok(Date.now() < deadline);
      return {
        kind: "official-publication",
        caseID: operation.caseID,
        relative: operation.relative,
        fingerprint,
        head: { ...head, version: 0 },
      };
    } catch {
      if (Date.now() >= deadline) break;
      await Bun.sleep(Math.min(500, deadline - Date.now()));
    }
  }
  throw new Error(
    "Official remote publication was not proven within its deadline",
  );
}
async function captureOfficialStep(
  runtime: GuestRuntime,
  operation: Extract<OfficialOperation, { kind: "official-step" }>,
  request: GuestRequest,
): Promise<ExecutionResult> {
  const title = `Official UI ${runtime.config.runID}-${String(request.binding.round)}${operation.step === "create" ? "" : " edited"}`;
  const matches: string[] = [];
  for await (const relative of new Bun.Glob("Tasks/**/*.md").scan({
    cwd: runtime.paths.referenceDirectory,
    onlyFiles: true,
  })) {
    const file = path.join(runtime.paths.referenceDirectory, relative),
      metadata = await lstat(file);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    const bytes = await readFile(file, "utf8"),
      yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(bytes)?.[1];
    if (yaml === undefined) continue;
    const properties = z
      .record(z.string(), z.unknown())
      .parse(Bun.YAML.parse(yaml));
    if (properties["title"] === title) {
      assert.equal(
        properties["status"],
        operation.step === "complete" ? "done" : "open",
      );
      assert.equal(
        properties["completedDate"] !== undefined &&
          properties["completedDate"] !== null,
        operation.step === "complete",
      );
      matches.push(relative);
    }
  }
  assert.equal(
    matches.length,
    1,
    "Perform the normal TaskNotes UI action exactly once before its checkpoint",
  );
  const relative = matches[0];
  assert.ok(relative);
  await officialRead(runtime, ["open", `path=${relative}`]);
  const guard = `(()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(runtime.paths.referenceDirectory)}||app.workspace.getActiveFile()?.path!==${JSON.stringify(relative)}||app.setting.modalEl.isConnected||document.querySelector('input[type="password"],.mod-settings,.modal-container'))throw Error('unsafe-reference-interface');return true;})()`;
  assert.equal(
    parseOfficialEvalBoolean(
      await officialRead(runtime, ["eval", `code=${guard}`]),
    ),
    true,
  );
  const evidenceRelative = `official-ui/round-${String(request.binding.round)}/${operation.step}.png`,
    file = path.join(runtime.paths.evidenceDirectory, evidenceRelative);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  assert.equal(await realpath(path.dirname(file)), path.dirname(file));
  assert.equal(
    await Bun.file(file).exists(),
    false,
    "Inspect an existing UI checkpoint instead of replacing it",
  );
  await officialRead(runtime, ["dev:screenshot", `path=${file}`]);
  assert.equal(
    parseOfficialEvalBoolean(
      await officialRead(runtime, ["eval", `code=${guard}`]),
    ),
    true,
  );
  const metadata = await lstat(file);
  assert.ok(
    metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.(),
  );
  const bytes = await readFile(file);
  validateOfficialScreenshot(bytes);
  return {
    kind: "official-step",
    step: operation.step,
    evidenceRelative,
    fingerprint: { size: bytes.length, sha256: contentSHA(bytes) },
  };
}
