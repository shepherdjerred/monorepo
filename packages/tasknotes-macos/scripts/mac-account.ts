import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { ManifestSchema } from "../../tasks-for-obsidian/scripts/apple-sync-live/model.ts";
import { parseArguments, runDirectory } from "./mac-account-contract.ts";
import { PasswordManagerFailure } from "../../tasks-for-obsidian/scripts/apple-sync-live/transport/execution/credential-host.ts";
import { runHostGuestAccount } from "../../tasks-for-obsidian/scripts/apple-sync-live/transport/execution/account-host.ts";

type Payload = Record<string, unknown>;

/** Allowlist every field before a native receipt reaches stdout. */
export function closedReceipt(value: unknown): Payload {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  const allowed = new Set([
    "runID",
    "pid",
    "startSeconds",
    "startMicroseconds",
    "launchDate",
    "ready",
    "stage",
    "readOnly",
    "requestID",
    "normalNavigationPressCount",
    "normalAXPressResult",
    "submitActionCount",
    "ownedAppActivated",
    "credentialsEntered",
    "clearDisabledCheckpointCount",
    "signInEnabled",
    "blocked",
    "phase",
  ]);
  const output: Payload = {};
  for (const [key, entry] of Object.entries(value)) {
    assert.ok(allowed.has(key));
    if (["runID", "requestID"].includes(key))
      assert.ok(typeof entry === "string" && /^[0-9a-f-]{36}$/iu.test(entry));
    else if (key === "stage")
      assert.ok(
        typeof entry === "string" &&
          ["credentials", "verification", "vaults"].includes(entry),
      );
    else if (key === "blocked" || key === "phase")
      assert.ok(
        typeof entry === "string" &&
          [
            "input",
            "bind-process",
            "process",
            "run",
            "window",
            "field",
            "setter",
            "action",
            "internal",
            "session",
          ].includes(entry),
      );
    else if (
      [
        "pid",
        "startSeconds",
        "startMicroseconds",
        "launchDate",
        "normalNavigationPressCount",
        "normalAXPressResult",
        "submitActionCount",
        "clearDisabledCheckpointCount",
      ].includes(key)
    )
      assert.ok(typeof entry === "number" && Number.isFinite(entry));
    else assert.equal(typeof entry, "boolean");
    output[key] = entry;
  }
  return output;
}

export async function main(args: string[]) {
  try {
    assert.equal(process.platform, "darwin");
    const { runID, operation, parameters, lifecycleRound } =
      parseArguments(args);
    const filename = path.join(runDirectory(runID), "manifest.json");
    const metadata = await lstat(filename);
    assert.ok(
      metadata.isFile() &&
        metadata.size <= 65_536 &&
        (await realpath(filename)) === filename,
    );
    const manifest = ManifestSchema.parse(
      JSON.parse(await readFile(filename, "utf8")),
    );
    if (manifest.schemaVersion !== 3) {
      console.log(
        JSON.stringify({
          blocked: "guest_execution_required",
          submissionStatus: "not_attempted",
        }),
      );
      return 3;
    }
    return await runHostGuestAccount({
      manifest,
      operation,
      parameters,
      ...(lifecycleRound === undefined ? {} : { lifecycleRound }),
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        blocked:
          error instanceof PasswordManagerFailure
            ? error.classification
            : "driver_contract",
        submissionStatus: "not_attempted",
      }),
    );
    return 3;
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
