import assert from "node:assert/strict";
import { z } from "zod";
import { readManifest, save } from "../../platform.ts";
import { assertUnchangedBuild } from "../../ledger.ts";
import { requestGuest } from "../client.ts";
import { UuidSchema } from "../fields.ts";
import type { ExecutionOperation } from "./contract.ts";
import { readHostCredentialItem } from "./credential-host.ts";

export function parseOfficialAccountArguments(args: string[]) {
  const [run, mode, ...parameters] = args;
  const runID = UuidSchema.parse(run);
  const operation = z
    .enum(["launch", "plugin", "present", "probe", "credentials"])
    .parse(mode);
  const options: Record<string, string> = {};
  for (let index = 0; index < parameters.length; index += 2) {
    const key = z
      .enum(["--account", "--vault", "--item", "--plugin-export"])
      .parse(parameters[index]);
    const value =
      key === "--plugin-export"
        ? UuidSchema.parse(parameters[index + 1])
        : z
            .string()
            .regex(/^[A-Za-z0-9]{20,32}$/u)
            .parse(parameters[index + 1]);
    assert.equal(options[key], undefined, "Duplicate credential locator");
    options[key] = value;
  }
  assert.deepEqual(
    Object.keys(options).sort(),
    operation === "credentials"
      ? ["--account", "--item", "--vault"]
      : operation === "plugin"
        ? ["--plugin-export"]
        : [],
  );
  return { runID, operation, options };
}
/** Host-only private broker; source, run and native form are checked again after password-manager approval. */
export async function runOfficialAccountCLI(args: string[]): Promise<number> {
  let submitting = false;
  try {
    const { runID, operation, options } = parseOfficialAccountArguments(args);
    const initial = await readManifest(runID);
    assert.equal(initial.schemaVersion, 3);
    const fresh = async () => {
      const manifest = await readManifest(runID);
      assert.equal(manifest.schemaVersion, 3);
      assert.deepEqual(manifest.execution, initial.execution);
      assert.equal(manifest.round, initial.round);
      assert.equal(manifest.stage, "owner-setup");
      assert.equal(manifest.failures.length, 0);
      assert.equal(manifest.allowedRemoteVaultID, initial.allowedRemoteVaultID);
      await assertUnchangedBuild(manifest);
      await save(manifest);
      return manifest;
    };
    const invoke = async (
      action: Extract<
        ExecutionOperation,
        { kind: "official-account" }
      >["action"],
    ) => {
      const manifest = await fresh();
      const result = await requestGuest(manifest, {
        kind: "official-account",
        action,
      });
      assert.equal(result.kind, "official-account");
      if ("blocked" in result.receipt) {
        console.log(JSON.stringify(result.receipt));
        throw new Error("Official private helper rejected the current form");
      }
      return result.receipt;
    };
    if (operation === "launch" || operation === "plugin") {
      const manifest = await fresh();
      const result = await requestGuest(
        manifest,
        operation === "launch"
          ? { kind: "official-launch" }
          : {
              kind: "official-plugin",
              exportID: UuidSchema.parse(options["--plugin-export"]),
            },
      );
      assert.equal(
        result.kind,
        operation === "launch" ? "official-launch" : "official-plugin",
      );
      console.log(JSON.stringify(result));
      return 0;
    }
    const inspected = await invoke({
      mode: operation === "present" ? "present" : "inspect",
    });
    if (operation === "present") {
      console.log(
        JSON.stringify({
          phase: "official-form-ready",
          ready: inspected.ready,
          submitActionCount: 0,
        }),
      );
      return 0;
    }
    const lifetime = {
      startSeconds: inspected.startSeconds,
      startMicroseconds: inspected.startMicroseconds,
      launchDate: inspected.launchDate,
    };
    if (operation === "probe") {
      const proof = await invoke({ mode: "probe", lifetime });
      assert.equal(proof.cleared, true);
      assert.equal(proof.submitActionCount, 0);
      console.log(JSON.stringify(proof));
      return 0;
    }
    assert.equal(
      inspected.probeReady,
      true,
      "Saved current integrated probe is required before reading1Password",
    );
    assert.equal(
      inspected.submissionAttempted,
      false,
      "Inspect the retained prior submission before reading1Password again",
    );
    const credentials = readHostCredentialItem({
      "--account": options["--account"] ?? "",
      "--vault": options["--vault"] ?? "",
      "--item": options["--item"] ?? "",
    });
    const filled = await invoke({ mode: "fill", ...credentials, lifetime });
    assert.equal(filled.emailLength, credentials.email.length);
    assert.equal(filled.passwordLength, credentials.password.length);
    assert.equal(filled.focusedSecureField, true);
    assert.equal(filled.loginEnabled, true);
    assert.equal(filled.submitActionCount, 0);
    submitting = true;
    const submitted = await invoke({ mode: "submit", lifetime });
    assert.equal(submitted.submitActionCount, 1);
    console.log(
      JSON.stringify({
        phase: "official-signin-submitted",
        authenticationResult: "not-yet-inspected",
        submitActionCount: 1,
      }),
    );
    return 0;
  } catch {
    console.log(
      JSON.stringify({
        blocked: "official-account-guard",
        submissionStatus: submitting ? "unknown" : "not-attempted",
      }),
    );
    return 3;
  }
}
if (import.meta.main)
  process.exitCode = await runOfficialAccountCLI(Bun.argv.slice(2));
