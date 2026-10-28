import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { assertUnchangedBuild } from "../../tasks-for-obsidian/scripts/apple-sync-live/ledger.ts";
import { ManifestSchema } from "../../tasks-for-obsidian/scripts/apple-sync-live/model.ts";
import {
  assertLifecycleEvidence,
  checkpointPath,
  lifecycleCheckpoint,
  verifyLifecycleReplica,
} from "./mac-account-lifecycle.ts";
import {
  assertFreshInitialStatus,
  bindingFor,
  childEnvironment,
  credentialBackend,
  vaultPasswordBackend,
  exactPID,
  parseArguments,
  root,
  runDirectory,
} from "./mac-account-contract.ts";
import {
  PasswordManagerFailure,
  readHostCredentialItem,
  readHostVerificationCode,
  readHostVaultPassword,
} from "../../tasks-for-obsidian/scripts/apple-sync-live/transport/execution/credential-host.ts";

type Payload = Record<string, unknown>;
class DriverFailure extends Error {
  constructor(readonly classification: string) {
    super(classification);
  }
}

const environment = childEnvironment(Bun.env);
const packageRoot = path.resolve(import.meta.dir, "..");
const helperSources = [
  "main.swift",
  "AccountRuntime.swift",
  "AccountOwner.swift",
  "AccountLifecycle.swift",
].map((name) => path.join(import.meta.dir, "native/mac-account", name));
const sha = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function helperSourceHash() {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const filename of helperSources) {
    hasher.update(path.basename(filename));
    hasher.update(await readFile(filename));
  }
  return hasher.digest("hex");
}

async function safeJSON(filename: string): Promise<unknown> {
  const stat = await lstat(filename);
  assert.ok(
    stat.isFile() &&
      stat.size <= 65_536 &&
      (await realpath(filename)) === filename,
  );
  return JSON.parse(await readFile(filename, "utf8"));
}

function captured(argv: string[], timeout: number, input?: string) {
  const result = spawnSync(argv[0] ?? "", argv.slice(1), {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout,
    maxBuffer: 1_048_576,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error || result.signal)
    throw new DriverFailure("bounded_child_failure");
  return { stdout: result.stdout, stderr: result.stderr, code: result.status };
}

async function compileHelper() {
  const parent = path.join(packageRoot, ".build/account-driver");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(parent), parent);
  const directory = await mkdtemp(path.join(parent, "helper-"));
  await chmod(directory, 0o700);
  const helper = path.join(directory, "mac-account-input");
  const sourceHash = await helperSourceHash();
  const result = captured(
    ["/usr/bin/xcrun", "swiftc", ...helperSources, "-o", helper],
    60_000,
  );
  if (result.code !== 0) throw new DriverFailure("helper_compile");
  assert.equal(await helperSourceHash(), sourceHash);
  await chmod(helper, 0o700);
  return { helper, sourceHash, binaryHash: sha(await readFile(helper)) };
}

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
  let submissionPossible = false;
  try {
    assert.equal(process.platform, "darwin");
    const { runID, operation, parameters, lifecycleRound } =
      parseArguments(args);
    const directory = runDirectory(runID);
    const state = path.join(
      homedir(),
      "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data/Library/Application Support/FacetAcceptance",
      runID,
    );
    const manifest = ManifestSchema.parse(
      await safeJSON(path.join(directory, "manifest.json")),
    );
    if (manifest.schemaVersion === 3) {
      const { runHostGuestAccount } =
        await import("../../tasks-for-obsidian/scripts/apple-sync-live/transport/execution/account-host.ts");
      return runHostGuestAccount({
        manifest,
        operation,
        parameters,
        ...(lifecycleRound === undefined ? {} : { lifecycleRound }),
      });
    }
    const binding = bindingFor(
      runID,
      manifest,
      await safeJSON(path.join(state, "acceptance.json")),
      lifecycleRound,
    );
    await assertUnchangedBuild(manifest);
    const checkpoint =
      lifecycleRound === undefined
        ? null
        : lifecycleCheckpoint(
            manifest,
            await safeJSON(checkpointPath(directory)),
            lifecycleRound,
          );
    const lifecycle =
      checkpoint === null
        ? null
        : {
            round: checkpoint.round,
            profileID: checkpoint.profileID,
            pendingCount: checkpoint.pendingCount,
            outboxSHA256: checkpoint.outbox.sha256,
            checkpointSHA256: sha(await readFile(checkpointPath(directory))),
          };
    async function validateState(reauthorized = false) {
      const current = ManifestSchema.parse(
        await safeJSON(path.join(directory, "manifest.json")),
      );
      assert.deepEqual(
        bindingFor(
          runID,
          current,
          await safeJSON(path.join(state, "acceptance.json")),
          lifecycleRound,
        ),
        binding,
      );
      const status = await safeJSON(path.join(state, "control/status.json"));
      if (checkpoint === null || lifecycle === null)
        assertFreshInitialStatus(status, runID);
      else {
        assert.deepEqual(
          lifecycleCheckpoint(
            current,
            await safeJSON(checkpointPath(directory)),
            lifecycle.round,
          ),
          checkpoint,
        );
        assert.equal(
          sha(await readFile(checkpointPath(directory))),
          lifecycle.checkpointSHA256,
        );
        const outbox = await verifyLifecycleReplica(current, checkpoint);
        assertLifecycleEvidence(
          current,
          checkpoint,
          status,
          outbox,
          await safeJSON(path.join(state, "control/interruption.json")),
          reauthorized,
        );
      }
    }
    await validateState();
    assert.equal(await realpath(binding.executable), binding.executable);
    const built = await compileHelper();
    const processResult = captured(["/bin/ps", "-axo", "pid=,comm="], 5_000);
    assert.equal(processResult.code, 0);
    const pid = exactPID(processResult.stdout, binding.executable);
    async function native(input: Payload) {
      assert.equal(sha(await readFile(built.helper)), built.binaryHash);
      assert.equal(await helperSourceHash(), built.sourceHash);
      // Revalidate replica and immutable pending work before each addressed
      // operation, including after a password-manager approval changes focus.
      await validateState();
      const result = captured(
        [built.helper],
        60_000,
        JSON.stringify({ ...binding, lifecycle, pid, ...input }),
      );
      const lines = result.stdout.trim().split("\n");
      assert.equal(lines.length, 1);
      const receipt = closedReceipt(JSON.parse(lines[0] ?? ""));
      console.log(JSON.stringify(receipt));
      if (result.code !== 0 || "blocked" in receipt)
        throw new DriverFailure("native_guard");
      return receipt;
    }
    const inspected = await native({
      mode:
        operation === "present"
          ? lifecycle === null
            ? "inspect_onboarding"
            : "inspect_workspace"
          : `inspect_${operation}`,
    });
    assert.equal(inspected["ready"], true);
    const lifetime = Object.fromEntries(
      ["startSeconds", "startMicroseconds", "launchDate"].map((key) => [
        key,
        inspected[key],
      ]),
    );
    if (operation === "present") {
      await native({
        ...lifetime,
        mode:
          lifecycle === null ? "present_account" : "present_lifecycle_account",
      });
      return 0;
    }
    await native({ ...lifetime, mode: `activate_${operation}` });
    // Use the harness's complete candidate/source validator, rather than a
    // basename or helper-only pin, before accessing the password manager.
    await assertUnchangedBuild(manifest);
    await validateState();
    console.log(
      JSON.stringify({
        phase: "password_manager_read",
        operation,
        submissionStatus: "not_attempted",
      }),
    );
    const selected = {
      "--account": parameters["--account"] ?? "",
      "--vault": parameters["--vault"] ?? "",
      "--item": parameters["--item"] ?? "",
    };
    const backend = credentialBackend(parameters["--credential-backend"]);
    const secret =
      operation === "credentials"
        ? readHostCredentialItem(selected, backend)
        : operation === "verification"
          ? readHostVerificationCode(selected, backend)
          : readHostVaultPassword(
              parameters["--vault-password-ref"] ?? "",
              vaultPasswordBackend(parameters["--vault-password-backend"]),
            );
    // Approval can take a minute: the candidate must still be the exact frozen
    // build before any retrieved value is handed to native UI.
    await assertUnchangedBuild(manifest);
    // A normal 1Password prompt may have changed focus. Rebind the exact process
    // and sheet before any secret is sent through the helper's private stdin.
    await native({ ...lifetime, mode: `activate_${operation}` });
    if (operation === "credentials") {
      assert.ok(typeof secret !== "string");
      const receipt = await native({
        ...lifetime,
        mode: "fill_credentials",
        ...secret,
      });
      assert.equal(receipt["clearDisabledCheckpointCount"], 2);
      assert.equal(receipt["signInEnabled"], true);
      assert.equal(receipt["submitActionCount"], 0);
      submissionPossible = true;
      await native({ ...lifetime, mode: "submit_credentials" });
    } else {
      assert.ok(typeof inspected["requestID"] === "string");
      assert.ok(typeof secret === "string");
      const value = secret;
      submissionPossible = true;
      await native({
        ...lifetime,
        mode: operation === "verification" ? "verify" : "connect",
        requestID: inspected["requestID"],
        ...(operation === "verification"
          ? { code: value }
          : { vaultPassword: value }),
      });
      if (operation === "vault" && lifecycle !== null) {
        const deadline = Date.now() + 30_000;
        while (true) {
          const snapshot = await safeJSON(
            path.join(state, "control/status.json"),
          );
          assert.ok(
            typeof snapshot === "object" &&
              snapshot !== null &&
              "accountBusy" in snapshot &&
              "profiles" in snapshot &&
              Array.isArray(snapshot.profiles),
          );
          assert.equal(snapshot.profiles.length, 1);
          const profile: unknown = snapshot.profiles[0];
          assert.ok(
            typeof profile === "object" &&
              profile !== null &&
              "profileID" in profile &&
              profile.profileID === lifecycle.profileID &&
              "phase" in profile,
          );
          if (
            snapshot.accountBusy === false &&
            profile.phase !== "reconnectRequired" &&
            profile.phase !== "connecting"
          )
            break;
          if (Date.now() >= deadline)
            throw new DriverFailure("lifecycle_reauthorization_timeout");
          await Bun.sleep(250);
        }
        await validateState(true);
        console.log(
          JSON.stringify({
            runID,
            lifecycleRound: lifecycle.round,
            originalProfileRetained: true,
            immutableOutboxRetained: true,
            transportRemainsInterrupted: true,
          }),
        );
      }
    }
    return 0;
  } catch (error: unknown) {
    console.log(
      JSON.stringify({
        blocked:
          error instanceof PasswordManagerFailure
            ? error.classification
            : error instanceof DriverFailure
              ? error.classification
              : "driver_contract",
        submissionStatus: submissionPossible ? "unknown" : "not_attempted",
      }),
    );
    return 3;
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
