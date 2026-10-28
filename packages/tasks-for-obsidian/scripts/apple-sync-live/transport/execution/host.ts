import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { GuestExecutionSchema } from "../contract.ts";
import { requestGuest } from "../client.ts";
import type { GuestManifest } from "../host.ts";
import {
  encodeBlob,
  RelativePathSchema,
  SHA256Schema,
  UuidSchema,
} from "../fields.ts";
import {
  LiveConfigSchema,
  helperFiles,
  liveGuestBun,
  liveShare,
} from "./config.ts";
import { macFileSHA } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";
import {
  loadMacVMExport,
  prepareMacVMExport,
  readOwnedMacVMJSON,
} from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { occurrenceCommand } from "tasknotes-macos/scripts/occurrence-acceptance/run-macos.ts";
import { guestBootstrap } from "./bootstrap-code.ts";

const macRoot = path.resolve(import.meta.dir, "../../../../../tasknotes-macos");
const OfficialExportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("signed-official-obsidian-local-copy"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  exportID: UuidSchema,
  archive: z.string(),
  sha256: SHA256Schema,
  bytes: z.number().int().positive(),
  sourceSignatureVerified: z.literal(true),
});
export type GuestLivePreparation = {
  vm: string;
  runID: string;
  scope: "macos" | "apple";
  seedDirectory: string;
  runnerIdentity?: string;
  sourceFiles: Record<string, string>;
  officialApp: { exportID: string; archiveSHA256: string };
};

/** Prepare one current signed artifact; no app, native test or account UI is launched. */
export async function prepareGuestLiveRun(options: GuestLivePreparation) {
  UuidSchema.parse(options.runID);
  assert.match(options.vm, /^[A-Za-z0-9][\w.-]{0,80}$/u);
  assert.equal(options.runnerIdentity, Bun.env["TASKNOTES_UITEST_IDENTITY"]);
  const buildID = crypto.randomUUID(),
    base = path.join(macRoot, ".build/occurrence-vm");
  const evidence = path.join(base, "builds", buildID);
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const command = occurrenceCommand(macRoot, evidence);
  await command(["tart", "exec", options.vm, "/usr/bin/true"]);
  const tools = path.join(base, "tools"),
    bun = path.join(tools, "bun"),
    runtime = await realpath(process.execPath);
  await mkdir(tools, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(tools), tools);
  if (!(await Bun.file(bun).exists())) {
    await copyFile(runtime, bun, constants.COPYFILE_EXCL);
    await chmod(bun, 0o755);
  }
  assert.equal(await macFileSHA(bun), await macFileSHA(runtime));
  const officialDirectory = path.join(
    base,
    "exports",
    `official-obsidian-${UuidSchema.parse(options.officialApp.exportID)}`,
  );
  assert.equal(await realpath(officialDirectory), officialDirectory);
  const official = OfficialExportSchema.parse(
    await readOwnedMacVMJSON(
      path.join(officialDirectory, "artifact.json"),
      4096,
    ),
  );
  assert.equal(official.exportID, options.officialApp.exportID);
  assert.equal(
    official.sha256,
    SHA256Schema.parse(options.officialApp.archiveSHA256),
  );
  assert.equal(
    official.archive,
    path.join(officialDirectory, `Obsidian-${official.version}.zip`),
  );
  assert.equal(await macFileSHA(official.archive), official.sha256);
  const archiveMetadata = await lstat(official.archive);
  assert.equal(archiveMetadata.size, official.bytes);
  const exported = await prepareMacVMExport(macRoot, buildID, command);
  const helpers = path.join(exported.directory, "live-helpers");
  await mkdir(helpers, { mode: 0o700 });
  const helperHashes: Record<string, string> = {};
  for (const name of helperFiles) {
    const source = helperSource(name);
    await copyFile(source, path.join(helpers, name), constants.COPYFILE_EXCL);
    helperHashes[name] = await macFileSHA(source);
    assert.equal(
      await macFileSHA(path.join(helpers, name)),
      helperHashes[name],
    );
  }
  const bundle = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "guest.ts")],
    outdir: exported.directory,
    naming: "live-guest.js",
    target: "bun",
  });
  assert.ok(bundle.success, "Live guest bundling failed");
  const seed: Record<string, ReturnType<typeof encodeBlob>> = {};
  assert.equal(await realpath(options.seedDirectory), options.seedDirectory);
  for await (const name of new Bun.Glob("**/*").scan({
    cwd: options.seedDirectory,
    dot: true,
    onlyFiles: false,
  })) {
    RelativePathSchema.parse(name);
    const file = path.join(options.seedDirectory, name),
      metadata = await lstat(file);
    assert.ok(
      !metadata.isSymbolicLink() && metadata.uid === process.getuid?.(),
    );
    if (metadata.isDirectory()) continue;
    assert.ok(metadata.isFile());
    seed[name] = encodeBlob(await readFile(file));
  }
  const config = LiveConfigSchema.parse({
    schemaVersion: 1,
    runID: options.runID,
    buildID,
    scope: options.scope,
    packageRoot: macRoot,
    sourceHead: exported.artifact.sourceHead,
    artifactSHA256: await macFileSHA(
      path.join(exported.directory, "artifact.json"),
    ),
    payloadSHA256: exported.payloadSHA256,
    liveBundleSHA256: await macFileSHA(
      path.join(exported.directory, "live-guest.js"),
    ),
    sourceFiles: options.sourceFiles,
    helpers: helperHashes,
    seed,
    officialApp: {
      exportID: official.exportID,
      archiveSHA256: official.sha256,
      version: official.version,
    },
  });
  const configFile = path.join(exported.directory, "live-config.json");
  await writeFile(configFile, JSON.stringify(config), {
    flag: "wx",
    mode: 0o600,
  });
  const execution = GuestExecutionSchema.parse({
    kind: "tart-guest",
    vm: options.vm,
    guestRunID: options.runID,
    artifactBuildID: buildID,
    artifactSHA256: config.artifactSHA256,
    payloadSHA256: config.payloadSHA256,
    guestConfigSHA256: await macFileSHA(configFile),
    guestBundleSHA256: config.liveBundleSHA256,
    guestBundlePath: path.join(liveShare, buildID, "live-guest.js"),
  });
  const bootstrap = guestBootstrap("bootstrapGuestLiveRun");
  const prepared = z
    .strictObject({
      schemaVersion: z.literal(1),
      runID: UuidSchema,
      container: z.string(),
      descriptor: z.string(),
      stateDirectory: z.string(),
    })
    .parse(
      JSON.parse(
        await command(
          [
            "tart",
            "exec",
            options.vm,
            liveGuestBun,
            "-e",
            bootstrap,
            execution.guestBundlePath,
            execution.guestBundleSHA256,
            execution.guestConfigSHA256,
            execution.artifactSHA256,
            execution.payloadSHA256,
          ],
          true,
        ),
      ),
    );
  assert.equal(prepared.runID, options.runID);
  const { container, descriptor, stateDirectory } = prepared;
  const macApp = path.join(
    exported.directory,
    "products/Debug/FacetAcceptance.app",
  );
  return {
    execution,
    macos: { container, descriptor, stateDirectory },
    macApp,
    provenance: {
      sourceHead: config.sourceHead,
      sourceFiles: options.sourceFiles,
      macAppDirectory: macApp,
      artifactBuildID: buildID,
      artifactSHA256: config.artifactSHA256,
      payloadSHA256: config.payloadSHA256,
      guestConfigSHA256: execution.guestConfigSHA256,
    },
  };
}

/** Host export/source fences plus actual guest installed-code verification; never a rebuild. */
export async function verifyGuestLiveRun(
  manifest: GuestManifest,
): Promise<void> {
  const execution = GuestExecutionSchema.parse(manifest.execution);
  const evidence = path.join(
    macRoot,
    ".build/occurrence-vm/builds",
    execution.artifactBuildID,
  );
  const exported = await loadMacVMExport(
    macRoot,
    execution.artifactBuildID,
    occurrenceCommand(macRoot, evidence),
  );
  assert.equal(exported.payloadSHA256, execution.payloadSHA256);
  assert.equal(
    await macFileSHA(path.join(exported.directory, "artifact.json")),
    execution.artifactSHA256,
  );
  assert.equal(
    await macFileSHA(path.join(exported.directory, "live-guest.js")),
    execution.guestBundleSHA256,
  );
  assert.equal(
    await macFileSHA(path.join(exported.directory, "live-config.json")),
    execution.guestConfigSHA256,
  );
  const result = await requestGuest(manifest, { kind: "verify" });
  assert.equal(result.kind, "verify");
  assert.equal(result.artifactSHA256, execution.artifactSHA256);
  assert.equal(result.payloadSHA256, execution.payloadSHA256);
  assert.equal(result.guestConfigSHA256, execution.guestConfigSHA256);
  assert.equal(result.sourceHead, exported.artifact.sourceHead);
}

function helperSource(name: (typeof helperFiles)[number]): string {
  return name.startsWith("mac-process-owner")
    ? path.join(macRoot, "scripts/apple-acceptance", name)
    : name === "official-account.swift" ||
        name === "OfficialOwner.swift" ||
        name === "OfficialAccountContainer.swift" ||
        name === "OfficialVerification.swift" ||
        name === "official-verification.protocol.json"
      ? path.join(
          macRoot,
          "scripts/native/official-account",
          name === "official-account.swift" ? "main.swift" : name,
        )
      : path.join(
          macRoot,
          "scripts/native/mac-account",
          name === "account-main.swift" ? "main.swift" : name,
        );
}
