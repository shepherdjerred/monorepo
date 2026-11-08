import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { startSyncFixture } from "../../tasks-for-obsidian/scripts/sync-fixture/server";
import {
  syntheticAccount,
  syntheticVault,
} from "../../tasks-for-obsidian/scripts/sync-fixture/contract";
import { AcceptanceDeadline, boundedCommand } from "./bounded-command";
import { nativeInputs } from "./native-inputs";
import { assertInstrumentationSuccess } from "./instrumentation-results";

const sdk = process.env["ANDROID_HOME"];
const serial = process.env["ANDROID_SERIAL"];
assert.ok(
  sdk && serial && /^emulator-\d+$/.test(serial),
  "Set ANDROID_HOME and an explicit owned emulator ANDROID_SERIAL.",
);
const root = resolve(import.meta.dir, "..");
const adb = resolve(
  sdk,
  "platform-tools/adb" + (process.platform === "win32" ? ".exe" : ""),
);
const runID = crypto.randomUUID();
const artifacts = resolve(root, "artifacts/acceptance", serial, "sync", runID);
await mkdir(artifacts, { recursive: true });
const deadline = new AcceptanceDeadline(300_000);
const apk =
  "host/build/outputs/apk/androidTest/debug/host-debug-androidTest.apk";
const target = "red.sjer.facet.host.test";
const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(resolve(root, path)).arrayBuffer())
    .digest("hex");
const apkHash = await sha256(apk);
const producer = await nativeInputs(root);
const recordedProducer: unknown = await Bun.file(
  resolve(root, "build/rust-jni/source.manifest.json"),
).json();
assert.deepEqual(
  recordedProducer,
  producer,
  "Rebuild native artifacts from the current producer inputs.",
);
async function run(args: string[], timeoutMS = 20_000) {
  deadline.assertWithin();
  const result = await boundedCommand([adb, "-s", serial, ...args], {
    cwd: root,
    logs: resolve(artifacts, "commands"),
    timeoutMS: Math.min(timeoutMS, Math.ceil(deadline.remainingMS())),
  });
  deadline.assertWithin();
  return result.stdout.toString("utf8");
}
const sourcePaths = (
  await boundedCommand(
    [
      "rg",
      "--files",
      "--hidden",
      "-g",
      "!**/build/**",
      "-g",
      "!**/.gradle/**",
      "-g",
      "!**/.cxx/**",
      "-g",
      "!**/node_modules/**",
      "-g",
      "!artifacts/**",
      ".",
    ],
    {
      cwd: root,
      logs: resolve(artifacts, "commands"),
      timeoutMS: 20_000,
    },
  )
).stdout
  .toString("utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();
for await (const path of new Bun.Glob(
  "../tasks-for-obsidian/scripts/sync-fixture/*.ts",
).scan({ cwd: root, onlyFiles: true }))
  sourcePaths.push(path);
sourcePaths.push(
  "../tasknotes-fixtures/vault/upstream/obsidian-crypto.json",
  "../tasks-for-obsidian/package.json",
  "../../package.json",
  "../../bun.lock",
);
async function sources() {
  const hashes: Record<string, string> = {};
  for (const path of sourcePaths) hashes[path] = await sha256(path);
  return hashes;
}
const authoredInputs = await sources();
const fixture = await startSyncFixture({
  directory: await mkdtemp(resolve(artifacts, "fixture-")),
  runID,
});
const port = new URL(fixture.identity.httpOrigin).port;
let reversed = false;
let ownedTarget = false;
let primaryFailure: unknown;
let failed = false;
const cleanupFailures: unknown[] = [];
let successMessage = "";
try {
  assert.equal(
    (await run(["shell", "getprop", "ro.kernel.qemu"])).trim(),
    "1",
    "The synthetic lane requires an emulator.",
  );
  assert.equal(
    (await run(["shell", "getprop", "sys.boot_completed"])).trim(),
    "1",
    "Wait for the owned emulator to finish booting.",
  );
  const pageSize = Number(
    (await run(["shell", "getconf", "PAGE_SIZE"])).trim(),
  );
  assert.ok([4096, 16384].includes(pageSize));
  await run(["install", "-r", apk]);
  const installed = (await run(["shell", "pm", "path", target])).trim();
  assert.match(installed, /^package:\/data\/app\/[^\r\n]+\/base\.apk$/);
  assert.equal(
    (await run(["shell", "sha256sum", installed.slice("package:".length)]))
      .trim()
      .split(/\s+/)[0],
    apkHash,
  );
  // Only this lane's synthetic, self-instrumenting library test package is cleared.
  assert.equal((await run(["shell", "pm", "clear", target])).trim(), "Success");
  ownedTarget = true;
  await run(["reverse", `tcp:${port}`, `tcp:${port}`]);
  reversed = true;
  const config = Buffer.from(
    JSON.stringify({
      ...fixture.identity,
      email: syntheticAccount.email,
      password: syntheticAccount.password,
      verificationCode: syntheticAccount.verificationCode,
      vaultPassword: syntheticVault.password,
    }),
  ).toString("base64url");
  const transcript = await run(
    [
      "shell",
      "am",
      "instrument",
      "-w",
      "-r",
      "-e",
      "class",
      "red.sjer.facet.host.SyncFixtureRuntimeTest",
      "-e",
      "fixtureConfig",
      config,
      `${target}/androidx.test.runner.AndroidJUnitRunner`,
    ],
    260_000,
  );
  await Bun.write(resolve(artifacts, "instrumentation.txt"), transcript);
  assertInstrumentationSuccess(transcript, [
    "red.sjer.facet.host.SyncFixtureRuntimeTest#encryptedPeersRetryAndDurableOutboxReopenWithoutAnAccount",
  ]);
  await run([
    "pull",
    `/sdcard/Android/data/${target}/files/acceptance/sync-${runID}.json`,
    resolve(artifacts, "android.json"),
  ]);
  const inventory = fixture.snapshot();
  assert.equal(inventory.counters.protocolErrors, 0);
  assert.equal(inventory.counters.beforeCommitDisconnects, 1);
  assert.equal(inventory.counters.afterCommitDisconnects, 1);
  assert.ok(inventory.latestUID > 0 && inventory.files.length > 0);
  assert.equal(await sha256(apk), apkHash);
  assert.deepEqual(await nativeInputs(root), producer);
  assert.deepEqual(
    await sources(),
    authoredInputs,
    "Android or fixture sources changed during acceptance.",
  );
  deadline.assertWithin();
  await Bun.write(
    resolve(artifacts, "evidence.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        scope: "account-free-protocol-fixture-only",
        bunVersion: Bun.version,
        serial,
        pageSize,
        runID,
        apkHash,
        producer,
        authoredInputs,
        inventory,
        timeoutMS: deadline.timeoutMS,
        ...deadline.sample(),
      },
      null,
      2,
    ),
  );
  deadline.assertWithin();
  successMessage = `Android encrypted Sync fixture acceptance passed on ${serial} (${pageSize}-byte pages). Evidence: ${artifacts}`;
} catch (failure) {
  primaryFailure = failure;
  failed = true;
} finally {
  const cleanup = new AcceptanceDeadline(30_000);
  let processExited = !ownedTarget;
  async function cleanupRun(args: string[]) {
    cleanup.assertWithin();
    const result = await boundedCommand([adb, "-s", serial, ...args], {
      cwd: root,
      logs: resolve(artifacts, "cleanup-commands"),
      timeoutMS: Math.min(10_000, Math.ceil(cleanup.remainingMS())),
    });
    cleanup.assertWithin();
    return result.stdout.toString("utf8");
  }
  try {
    if (ownedTarget) {
      await cleanupRun(["shell", "am", "force-stop", target]);
      while (true) {
        const names = (await cleanupRun(["shell", "ps", "-A", "-o", "NAME"]))
          .split(/\r?\n/)
          .map((line) => line.trim());
        if (
          !names.some(
            (name) => name === target || name.startsWith(target + ":"),
          )
        ) {
          processExited = true;
          break;
        }
        cleanup.assertWithin();
        await Bun.sleep(50);
      }
    }
    if (reversed) {
      await cleanupRun(["reverse", "--remove", `tcp:${port}`]);
    }
  } catch (failure) {
    cleanupFailures.push(failure);
  } finally {
    try {
      await Bun.write(
        resolve(artifacts, "fixture-state.json"),
        JSON.stringify(fixture.snapshot(), null, 2),
      );
    } catch (failure) {
      cleanupFailures.push(failure);
    }
    // A device process whose exit is unproven still owns its fixture and reverse.
    if (processExited) {
      try {
        await fixture.close();
        cleanup.assertWithin();
      } catch (failure) {
        cleanupFailures.push(failure);
      }
    }
    try {
      await Bun.write(
        resolve(artifacts, "cleanup.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            target,
            ownedTarget,
            processExited,
            timeoutMS: cleanup.timeoutMS,
            ...cleanup.sample(),
            failures: cleanupFailures.map(String),
          },
          null,
          2,
        ),
      );
    } catch (failure) {
      cleanupFailures.push(failure);
    }
  }
}
if (failed || cleanupFailures.length > 0) {
  if (cleanupFailures.length > 0)
    throw new AggregateError(
      failed ? [primaryFailure, ...cleanupFailures] : cleanupFailures,
      `Android Sync acceptance or owned cleanup failed; inspect ${artifacts}`,
    );
  throw primaryFailure;
}
console.log(successMessage);
