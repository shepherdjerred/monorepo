import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { nativeInputs } from "./native-inputs";
import { AcceptanceDeadline, boundedCommand } from "./bounded-command.ts";

const acceptance = new AcceptanceDeadline(480_000);

const sdk = process.env["ANDROID_HOME"];
const configuredSerial = process.env["ANDROID_SERIAL"];
if (!sdk || !configuredSerial || !/^[\w.:-]+$/.test(configuredSerial))
  throw new Error(
    "Set ANDROID_HOME and an explicit ANDROID_SERIAL for native acceptance.",
  );
const serial = configuredSerial;
const adb = resolve(
  sdk,
  "platform-tools/adb" + (process.platform === "win32" ? ".exe" : ""),
);
const packageRoot = resolve(import.meta.dir, "..");
const artifacts = resolve(packageRoot, "artifacts/acceptance", serial);
mkdirSync(artifacts, { recursive: true });

const apkPackages = [
  ["app/build/outputs/apk/debug/app-debug.apk", "red.sjer.facet"],
  [
    "host/build/outputs/apk/androidTest/debug/host-debug-androidTest.apk",
    "red.sjer.facet.host.test",
  ],
  [
    "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
    "red.sjer.facet.test",
  ],
] as const;
const inputListing = await boundedCommand(
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
    cwd: packageRoot,
    logs: resolve(artifacts, "commands"),
    timeoutMS: Math.min(20_000, Math.ceil(acceptance.remainingMS())),
  },
);
const inputPaths = inputListing.stdout
  .toString("utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();
inputPaths.push(
  "../tasknotes-core/bindings/kotlin/uniffi/TaskNotesCore/TaskNotesCore.kt",
  "../tasknotes-fixtures/vault/facet-contract.json",
  "../tasknotes-fixtures/vault/facet-occurrence-contract.json",
  "../tasknotes-fixtures/vault/facet-raw-contract.json",
);
for await (const path of new Bun.Glob("../tasknotes-fixtures/schema/**").scan({
  cwd: packageRoot,
  onlyFiles: true,
}))
  inputPaths.push(path);

async function hashes(
  paths: readonly string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of paths)
    result[path] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(resolve(packageRoot, path)).arrayBuffer())
      .digest("hex");
  return result;
}

const authoredInputs = await hashes(inputPaths);
const testedArtifacts = await hashes([
  ...apkPackages.map(([path]) => path),
  "build/rust-jni/arm64-v8a/libtasknotes_core_ffi.so",
  "build/rust-jni/x86_64/libtasknotes_core_ffi.so",
]);
const rustBuild = (
  await Bun.file(resolve(packageRoot, "build/rust-jni/source.sha256")).text()
).trim();
if (!/^[a-f0-9]{64}$/.test(rustBuild))
  throw new Error("Rust build source fingerprint is missing or invalid.");
const producer = await nativeInputs(packageRoot);
const recordedProducer: unknown = await Bun.file(
  resolve(packageRoot, "build/rust-jni/source.manifest.json"),
).json();
if (
  producer.fingerprint !== rustBuild ||
  JSON.stringify(recordedProducer) !== JSON.stringify(producer)
)
  throw new Error(
    "Native libraries do not match the current full producer input inventory. Rebuild before acceptance.",
  );

async function run(args: string[]): Promise<string> {
  acceptance.assertWithin();
  const result = await boundedCommand([adb, "-s", serial, ...args], {
    cwd: packageRoot,
    logs: resolve(artifacts, "commands"),
    timeoutMS: Math.min(
      args[0] === "shell" && args[1] === "am" && args[2] === "instrument"
        ? 480_000
        : 20_000,
      Math.ceil(acceptance.remainingMS()),
    ),
  });
  acceptance.assertWithin();
  return result.stdout.toString("utf8");
}

const pageSize = (await run(["shell", "getconf", "PAGE_SIZE"])).trim();
if (!["4096", "16384"].includes(pageSize))
  throw new Error(`Unexpected emulator page size: ${pageSize}`);
for (const [apk, identity] of apkPackages) {
  await run(["install", "-r", apk]);
  const installed = (await run(["shell", "pm", "path", identity])).trim();
  if (!/^package:\/data\/app\/[^\r\n]+\/base\.apk$/.test(installed))
    throw new Error(`Unexpected installed APK path for ${identity}.`);
  const installedHash = (
    await run(["shell", "sha256sum", installed.slice("package:".length)])
  )
    .trim()
    .split(/\s+/)[0];
  if (installedHash !== testedArtifacts[apk])
    throw new Error(
      `Installed APK differs from the reviewed artifact for ${identity}.`,
    );
}
for (const [name, target] of [
  ["host", "red.sjer.facet.host.test"],
  ["compose", "red.sjer.facet.test"],
]) {
  const transcript = await run([
    "shell",
    "am",
    "instrument",
    "-w",
    "-r",
    `${target}/androidx.test.runner.AndroidJUnitRunner`,
  ]);
  await Bun.write(resolve(artifacts, `${name}.txt`), transcript);
  if (
    !/OK \(\d+ tests?\)/.test(transcript) ||
    /FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed/.test(transcript)
  )
    throw new Error(`${name} native acceptance failed; inspect ${artifacts}.`);
}
await run(["shell", "am", "start", "-W", "-n", "red.sjer.facet/.MainActivity"]);
await run(["shell", "uiautomator", "dump", "/sdcard/facet-acceptance.xml"]);
await run([
  "pull",
  "/sdcard/facet-acceptance.xml",
  resolve(artifacts, "hierarchy.xml"),
]);
acceptance.assertWithin();
const screenshot = await boundedCommand(
  [adb, "-s", serial, "exec-out", "screencap", "-p"],
  {
    cwd: packageRoot,
    logs: resolve(artifacts, "commands"),
    timeoutMS: Math.min(15_000, Math.ceil(acceptance.remainingMS())),
  },
);
acceptance.assertWithin();
await Bun.write(resolve(artifacts, "standalone.png"), screenshot.stdout);
await Bun.write(
  resolve(artifacts, "device.json"),
  JSON.stringify({ serial, pageSize: Number(pageSize) }, null, 2),
);
if (
  (await nativeInputs(packageRoot)).fingerprint !== producer.fingerprint ||
  JSON.stringify(await hashes(inputPaths)) !== JSON.stringify(authoredInputs) ||
  JSON.stringify(await hashes(Object.keys(testedArtifacts))) !==
    JSON.stringify(testedArtifacts)
)
  throw new Error(
    "Native source or artifacts changed during runtime acceptance; rerun a coherent build.",
  );
await Bun.write(
  resolve(artifacts, "deadline.json"),
  JSON.stringify(
    { timeoutMS: acceptance.timeoutMS, ...acceptance.sample() },
    null,
    2,
  ),
);
acceptance.assertWithin();
await Bun.write(
  resolve(artifacts, "evidence.json"),
  JSON.stringify(
    {
      schemaVersion: 2,
      serial,
      pageSize: Number(pageSize),
      testedArtifacts,
      authoredInputs,
      producer,
      rustBuild,
    },
    null,
    2,
  ),
);
acceptance.assertWithin();
console.log(
  `Native host and Compose acceptance passed on ${serial} (${pageSize}-byte pages). Screenshot: ${artifacts}/standalone.png`,
);
