import { expect, test } from "vitest";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeInputs } from "./native-inputs";
import { verifyNativeArtifacts } from "./native-artifacts";

const sourcePaths = [
  "Cargo.toml",
  "Cargo.lock",
  "../../.mise.toml",
  "../../LICENSE",
  "rust-toolchain.toml",
  "../tasknotes-android/scripts/native-inputs.ts",
  "../tasknotes-android/scripts/build-native.ts",
  "crates/tasknotes-runtime/src/engine.rs",
  "bindings/kotlin/TaskNotesCore.kt",
  "../tasknotes-fixtures/schema/facet-engine.schema.json",
];
const artifacts = [
  "source.sha256",
  "source.manifest.json",
  "arm64-v8a/libtasknotes_core_ffi.so",
  "x86_64/libtasknotes_core_ffi.so",
];
async function fixture(
  run: (app: string, core: string, output: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "facet-native-artifacts-"));
  const app = join(root, "packages/tasknotes-android");
  const core = join(root, "packages/tasknotes-core");
  const output = join(app, "build/rust-jni");
  try {
    for (const path of sourcePaths)
      await Bun.write(join(core, path), "original");
    const inventory = await nativeInputs(app);
    await Bun.write(
      join(output, "source.sha256"),
      inventory.fingerprint + "\n",
    );
    await Bun.write(
      join(output, "source.manifest.json"),
      JSON.stringify(inventory, null, 2),
    );
    for (const [abi, machine] of [
      ["arm64-v8a", 183],
      ["x86_64", 62],
    ] as const) {
      const header = new Uint8Array(64);
      header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
      const view = new DataView(header.buffer);
      view.setUint16(16, 3, true);
      view.setUint16(18, machine, true);
      view.setUint32(20, 1, true);
      view.setUint16(52, 64, true);
      await Bun.write(join(output, abi, "libtasknotes_core_ffi.so"), header);
    }
    await run(app, core, output);
  } finally {
    await rm(root, { recursive: true });
  }
}
test("matching complete producer evidence passes without rewriting any artifact", async () =>
  fixture(async (app, _, output) => {
    const before = await Promise.all(
      artifacts.map((path) => Bun.file(join(output, path)).bytes()),
    );
    expect(await verifyNativeArtifacts(app)).toEqual(await nativeInputs(app));
    for (const [index, path] of artifacts.entries())
      expect(await Bun.file(join(output, path)).bytes()).toEqual(before[index]);
  }));
test.each(artifacts)(
  "missing native evidence blocks consumers: %s",
  async (path) =>
    fixture(async (app, _, output) => {
      await rm(join(output, path));
      await expect(verifyNativeArtifacts(app)).rejects.toThrow(
        "Native artifact is missing",
      );
    }),
);
test.each([
  "crates/tasknotes-runtime/src/engine.rs",
  "bindings/kotlin/TaskNotesCore.kt",
  "../tasknotes-fixtures/schema/facet-engine.schema.json",
  "Cargo.lock",
  "../../.mise.toml",
  "rust-toolchain.toml",
])("changed source invalidates retained artifacts: %s", async (path) =>
  fixture(async (app, core) => {
    await Bun.write(join(core, path), "changed");
    await expect(verifyNativeArtifacts(app)).rejects.toThrow("stale");
    await Bun.write(join(core, path), "original");
    await expect(verifyNativeArtifacts(app)).resolves.toEqual(
      await nativeInputs(app),
    );
  }),
);
test("matching stamp cannot conceal a stale or malformed manifest", async () =>
  fixture(async (app, _, output) => {
    const inventory = await nativeInputs(app);
    await Bun.write(
      join(output, "source.manifest.json"),
      JSON.stringify({ ...inventory, inputs: {} }),
    );
    await expect(verifyNativeArtifacts(app)).rejects.toThrow(
      "manifest is invalid or stale",
    );
    await Bun.write(join(output, "source.manifest.json"), "invalid json");
    await expect(verifyNativeArtifacts(app)).rejects.toThrow();
  }));
test("invalid stamps and empty, foreign or symlinked libraries fail closed", async () =>
  fixture(async (app, _, output) => {
    const stamp = join(output, "source.sha256");
    const originalStamp = await Bun.file(stamp).text();
    await Bun.write(stamp, "invalid");
    await expect(verifyNativeArtifacts(app)).rejects.toThrow(
      "stamp is invalid or stale",
    );
    await Bun.write(stamp, originalStamp);
    const library = join(output, "x86_64/libtasknotes_core_ffi.so");
    const original = await Bun.file(library).bytes();
    await Bun.write(library, "");
    await expect(verifyNativeArtifacts(app)).rejects.toThrow(
      "nonempty regular file",
    );
    await Bun.write(library, "not ELF");
    await expect(verifyNativeArtifacts(app)).rejects.toThrow(
      "invalid ELF identity",
    );
    await Bun.write(
      library,
      await Bun.file(
        join(output, "arm64-v8a/libtasknotes_core_ffi.so"),
      ).bytes(),
    );
    await expect(verifyNativeArtifacts(app)).rejects.toThrow(
      "invalid ELF identity",
    );
    await rm(library);
    await symlink(join(output, "arm64-v8a/libtasknotes_core_ffi.so"), library);
    await expect(verifyNativeArtifacts(app)).rejects.toThrow("regular file");
    await rm(library);
    await Bun.write(library, original);
    await expect(verifyNativeArtifacts(app)).resolves.toEqual(
      await nativeInputs(app),
    );
  }));
