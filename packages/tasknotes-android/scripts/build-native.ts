import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { nativeInputs } from "./native-inputs";

const sdk = process.env["ANDROID_HOME"];
if (!sdk)
  throw new Error("ANDROID_HOME must identify the installed Android SDK.");
const ndk = resolve(sdk, "ndk/28.2.13676358");
if (
  !["darwin", "linux", "win32"].includes(process.platform) ||
  (process.platform !== "darwin" && process.arch !== "x64")
) {
  throw new Error(
    "NDK 28.2 native builds require macOS ARM64/x64 or Linux/Windows x64.",
  );
}
const prebuilt =
  process.platform === "darwin"
    ? "darwin-x86_64"
    : process.platform === "linux"
      ? "linux-x86_64"
      : "windows-x86_64";
const binaries = resolve(ndk, "toolchains/llvm/prebuilt", prebuilt, "bin");
const suffix = process.platform === "win32" ? ".cmd" : "";
const core = resolve(import.meta.dir, "../../tasknotes-core");
const output = resolve(import.meta.dir, "../build/rust-jni");
const targets = [
  {
    rust: "aarch64-linux-android",
    clang: "aarch64-linux-android29",
    abi: "arm64-v8a",
  },
  {
    rust: "x86_64-linux-android",
    clang: "x86_64-linux-android29",
    abi: "x86_64",
  },
];

const inventory = await nativeInputs(resolve(import.meta.dir, ".."));
const source = inventory.fingerprint;
async function fingerprint(): Promise<string> {
  return (await nativeInputs(resolve(import.meta.dir, ".."))).fingerprint;
}

for (const target of targets) {
  const linker = resolve(binaries, target.clang + "-clang" + suffix);
  if (!existsSync(linker))
    throw new Error(`Install NDK 28.2.13676358 before building ${target.abi}.`);
  const rustup = Bun.spawn(["rustup", "target", "add", target.rust], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await rustup.exited) !== 0)
    throw new Error(`Rust target installation failed: ${target.rust}`);
  const variable = target.rust.replaceAll("-", "_");
  const build = Bun.spawn(
    [
      "cargo",
      "build",
      "--locked",
      "--package",
      "tasknotes-core-ffi",
      "--target",
      target.rust,
      "--profile",
      "reldbg",
    ],
    {
      cwd: core,
      env: {
        ...process.env,
        [`CARGO_TARGET_${variable.toUpperCase()}_LINKER`]: linker,
        [`CC_${variable}`]: linker,
        [`AR_${variable}`]: resolve(
          binaries,
          "llvm-ar" + (process.platform === "win32" ? ".exe" : ""),
        ),
        [`CARGO_TARGET_${variable.toUpperCase()}_RUSTFLAGS`]:
          "-C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await build.exited) !== 0)
    throw new Error(`Rust native build failed: ${target.rust}`);
  if ((await fingerprint()) !== source)
    throw new Error(
      "Rust sources or generated bindings changed during the native build. Retry with a stable source tree.",
    );
}
// Publish both ABIs only after every target built from one verified source set.
for (const target of targets) {
  const directory = resolve(output, target.abi);
  mkdirSync(directory, { recursive: true });
  copyFileSync(
    resolve(core, "target", target.rust, "reldbg/libtasknotes_core_ffi.so"),
    resolve(directory, "libtasknotes_core_ffi.so"),
  );
}
if ((await fingerprint()) !== source)
  throw new Error(
    "Native artifacts changed source generation during publication.",
  );
await Bun.write(resolve(output, "source.sha256"), source + "\n");
await Bun.write(
  resolve(output, "source.manifest.json"),
  JSON.stringify(inventory, null, 2),
);
