import assert from "node:assert/strict";
import path from "node:path";
import { serveGuestTransport } from "../guest.ts";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { bootstrapLive } from "./bootstrap.ts";
import { createGuestRuntime } from "./runtime.ts";
import { runGuestNative } from "./native.ts";
import { runGuestAccount } from "./account.ts";
import { runGuestOfficial } from "./official.ts";
import { runGuestOfficialAccount } from "./official-account.ts";
import { prepareGuestOfficialVerification } from "./official-verification-guest";
import {
  authorizeGuestExecution,
  bindGuestVault,
  currentGuestBinding,
  StoredCheckpointSchema,
  writeGuestJSON,
} from "./state.ts";

/** Import alone never launches a runner, opens app UI, or consumes private stdin. */
export async function bootstrapGuestLiveRun(
  expectedConfigSHA256: string,
): Promise<void> {
  await bootstrapLive(import.meta.dir, expectedConfigSHA256);
}
export async function runGuestTransport(
  expectedConfigSHA256: string,
): Promise<void> {
  const runtime = await createGuestRuntime(
    import.meta.dir,
    expectedConfigSHA256,
  );
  await serveGuestTransport({
    paths: runtime.paths,
    preflight: runtime.verify,
    binding: (request) => currentGuestBinding(runtime, request),
    authorize: (request) => authorizeGuestExecution(runtime, request),
    execute: async (operation, request) => {
      let result;
      switch (operation.kind) {
        case "official-verification-prepare":
          result = await prepareGuestOfficialVerification(
            runtime,
            operation.operation,
          );
          break;
        case "checkpoint": {
          const checkpoint = StoredCheckpointSchema.parse({
            schemaVersion: 1,
            kind: "tart-guest-account-checkpoint",
            binding: request.binding,
            checkpoint: operation.checkpoint,
            guestConfigSHA256: runtime.expectedConfigSHA,
          });
          await writeGuestJSON(
            path.join(
              runtime.paths.evidenceDirectory,
              "account-checkpoint.json",
            ),
            checkpoint,
          );
          result = { kind: "checkpoint" as const, written: true as const };
          break;
        }
        case "descriptor":
          await bindGuestVault(runtime, operation.vaultID);
          result = { kind: "descriptor" as const, vaultID: operation.vaultID };
          break;
        case "retire":
          result = { kind: "retire" as const, ...(await runtime.retire()) };
          break;
        case "launch":
          assert.ok(
            operation.discovery ||
              request.binding.allowedRemoteVaultID !== null,
          );
          await runtime.retire();
          await runtime.command([
            "open",
            "-n",
            runtime.paths.app,
            "--args",
            "--facet-acceptance-descriptor",
            runtime.paths.descriptor,
          ]);
          result = {
            kind: "launch" as const,
            launched: true as const,
            discovery: operation.discovery,
          };
          break;
        case "verify":
          result = await runtime.withRunner(async (runner) => {
            const os = await import("node:os");
            const file = path.join(
              os.homedir(),
              "Library/Application Support/FacetAcceptanceHarness/readiness",
              `${runtime.config.payloadSHA256}-${runner.installationID}.json`,
            );
            let captureReady = false;
            if (await Bun.file(file).exists()) {
              const { requireMacVMCaptureReady } =
                await import("tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts");
              requireMacVMCaptureReady(await readOwnedMacVMJSON(file, 4096), {
                payloadSHA256: runtime.config.payloadSHA256,
                installationID: runner.installationID,
                bundlePath: runner.bundlePath,
                sourceHead: runtime.config.sourceHead,
              });
              captureReady = true;
            }
            return {
              kind: "verify" as const,
              artifactSHA256: runtime.config.artifactSHA256,
              payloadSHA256: runtime.config.payloadSHA256,
              sourceHead: runtime.config.sourceHead,
              guestConfigSHA256: runtime.expectedConfigSHA,
              runnerInstallationID: runner.installationID,
              captureReady,
            };
          }, false);
          break;
        case "native":
          result = await runGuestNative(runtime, operation, request);
          break;
        case "account":
          result = await runGuestAccount(runtime, operation, request);
          break;
        case "official-account":
          result = await runGuestOfficialAccount(runtime, operation);
          break;
        case "official-launch":
        case "official-plugin":
        case "official-info":
        case "official-step":
        case "official-publication":
          result = await runGuestOfficial(runtime, operation, request);
          break;
      }
      await runtime.verify();
      return result;
    },
  });
}
