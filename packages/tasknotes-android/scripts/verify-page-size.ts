import { resolve, basename } from "node:path";
import { mkdirSync } from "node:fs";

const sdk = process.env["ANDROID_HOME"];
if (!sdk)
  throw new Error("ANDROID_HOME must identify the installed Android SDK.");
const apk = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dir, "../app/build/outputs/apk/debug/app-debug.apk");
if (!apk.endsWith(".apk") || !(await Bun.file(apk).exists()))
  throw new Error("An existing APK is required for alignment verification.");
const binary = resolve(
  sdk,
  "build-tools/37.0.0/zipalign" + (process.platform === "win32" ? ".exe" : ""),
);
const check = Bun.spawn([binary, "-c", "-P", "16", "-v", "4", apk], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await check.exited) !== 0)
  throw new Error(
    "Packaged native libraries do not satisfy 16 KB APK alignment.",
  );

const hostTag =
  process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
const readelf = resolve(
  sdk,
  "ndk/28.2.13676358/toolchains/llvm/prebuilt",
  hostTag,
  "bin/llvm-readelf",
);
const listing = Bun.spawn(["unzip", "-Z1", apk], {
  stdout: "pipe",
  stderr: "inherit",
});
const entries = (await new Response(listing.stdout).text())
  .split("\n")
  .filter((entry) => /^lib\/[^/]+\/[^/]+\.so$/.test(entry));
if ((await listing.exited) !== 0 || entries.length === 0)
  throw new Error("APK native library inventory is unavailable.");
const expectedAbis = new Set(["arm64-v8a", "x86_64"]);
const found = new Set<string>();
for (const entry of entries) {
  const abi = entry.split("/")[1];
  if (!abi || !expectedAbis.has(abi))
    throw new Error(`Unexpected packaged ABI: ${entry}`);
  found.add(abi);
  const directory = resolve(import.meta.dir, "../build/native-alignment", abi);
  mkdirSync(directory, { recursive: true });
  const extracted = resolve(directory, basename(entry));
  const extraction = Bun.spawn(["unzip", "-p", apk, entry], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const bytes = await new Response(extraction.stdout).arrayBuffer();
  if ((await extraction.exited) !== 0)
    throw new Error(`Cannot inspect packaged library: ${entry}`);
  await Bun.write(extracted, bytes);
  const inspection = Bun.spawn(
    [readelf, "--program-headers", "--wide", extracted],
    { stdout: "pipe", stderr: "inherit" },
  );
  const headers = await new Response(inspection.stdout).text();
  if ((await inspection.exited) !== 0)
    throw new Error(`Invalid packaged ELF: ${entry}`);
  const segments = headers
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("LOAD "));
  if (
    segments.length === 0 ||
    segments.some((line) => {
      const alignment = Number(line.trim().split(/\s+/).at(-1));
      return (
        !Number.isSafeInteger(alignment) ||
        alignment < 16_384 ||
        (alignment & (alignment - 1)) !== 0
      );
    })
  )
    throw new Error(
      `Packaged ELF LOAD segments lack 16 KB alignment: ${entry}`,
    );
  console.log(`${entry}: all LOAD segments support 16 KB pages`);
}
if (found.size !== expectedAbis.size)
  throw new Error("Packaged native ABI set is incomplete.");
for (const abi of expectedAbis)
  for (const library of [
    "libtasknotes_core_ffi.so",
    "libfacet_files.so",
    "libjnidispatch.so",
  ]) {
    if (!entries.includes(`lib/${abi}/${library}`))
      throw new Error(
        `Required native dependency is absent: ${abi}/${library}`,
      );
  }
