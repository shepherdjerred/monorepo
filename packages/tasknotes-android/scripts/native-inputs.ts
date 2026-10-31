import { resolve } from "node:path";

/** Source bytes that can affect the native producer or its generated ABI. */
export async function nativeInputs(packageRoot: string): Promise<{
  schemaVersion: number;
  fingerprint: string;
  inputs: Record<string, string>;
}> {
  const core = resolve(packageRoot, "../tasknotes-core");
  const paths = new Set<string>([
    "Cargo.toml",
    "Cargo.lock",
    "../../.mise.toml",
    "../../LICENSE",
    "../tasknotes-android/scripts/native-inputs.ts",
    "../tasknotes-android/scripts/build-native.ts",
  ]);
  for (const pattern of [
    "rust-toolchain.toml",
    "uniffi.toml",
    ".cargo/**",
    "crates/*/Cargo.toml",
    "crates/*/build.rs",
    "crates/*/src/**",
    "xtask/Cargo.toml",
    "xtask/src/**",
    "bindings/kotlin/**/*.kt",
    "../tasknotes-fixtures/schema/**",
  ]) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: core,
      onlyFiles: true,
    }))
      paths.add(path);
  }
  const inputs: Record<string, string> = {};
  const fingerprint = new Bun.CryptoHasher("sha256");
  for (const path of [...paths].sort()) {
    const file = Bun.file(resolve(core, path));
    if (!(await file.exists()))
      throw new Error(`Native producer input is missing: ${path}`);
    const digest = new Bun.CryptoHasher("sha256")
      .update(await file.arrayBuffer())
      .digest("hex");
    inputs[path] = digest;
    fingerprint.update(path).update("\0").update(digest).update("\0");
  }
  return { schemaVersion: 2, fingerprint: fingerprint.digest("hex"), inputs };
}
