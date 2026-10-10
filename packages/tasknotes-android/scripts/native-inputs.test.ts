import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nativeInputs } from "./native-inputs";

test("native artifact provenance detects non-Rust sources, ABI schema and build options", async () => {
  const root = await mkdtemp(join(tmpdir(), "facet-native-inputs-"));
  const app = join(root, "packages/tasknotes-android");
  const core = join(root, "packages/tasknotes-core");
  const inputs = [
    "Cargo.toml",
    "Cargo.lock",
    "../../.mise.toml",
    "../../LICENSE",
    ".cargo/config.toml",
    "crates/tasknotes-vault/src/defaults.json",
    "xtask/src/swift.rs",
    "bindings/kotlin/TaskNotesCore.kt",
    "../tasknotes-fixtures/schema/facet-engine.schema.json",
    "../tasknotes-fixtures/schema/obsidian-sync.schema.json",
    "../tasknotes-android/scripts/native-inputs.ts",
    "../tasknotes-android/scripts/build-native.ts",
  ];
  try {
    for (const input of inputs) await Bun.write(join(core, input), "original");
    const baseline = await nativeInputs(app);
    expect(Object.keys(baseline.inputs).sort()).toEqual([...inputs].sort());
    expect((await nativeInputs(app)).fingerprint).toBe(baseline.fingerprint);
    for (const input of inputs) {
      await Bun.write(join(core, input), "changed");
      expect((await nativeInputs(app)).fingerprint).not.toBe(
        baseline.fingerprint,
      );
      await Bun.write(join(core, input), "original");
    }
    await Bun.write(join(core, "rust-toolchain.toml"), "toolchain");
    expect((await nativeInputs(app)).fingerprint).not.toBe(
      baseline.fingerprint,
    );
    await rm(join(core, "Cargo.lock"));
    await expect(nativeInputs(app)).rejects.toThrow(
      "Native producer input is missing: Cargo.lock",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
