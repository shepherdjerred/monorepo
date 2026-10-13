import { describe, expect, it } from "vitest";
import {
  runtimeFingerprint,
  RuntimeSchema,
  requiredRuntimeSettings,
} from "./runtime.ts";
import { thirdPartyPlugins } from "#e2e/harness/pins.ts";

const hash = (digit: string) => digit.repeat(64);
const runtime = () => ({
  serverImage: `example/java25@sha256:${hash("a")}`,
  imageId: `sha256:${hash("b")}`,
  paperSha256: hash("c"),
  paperRuntimeSha256: hash("d"),
  javaExecutableSha256: hash("e"),
  javaReleaseSha256: hash("f"),
  javaArgumentsSha256: hash("0"),
  plugins: thirdPartyPlugins.map((plugin) => ({
    file: `${plugin.name}-${plugin.version}.jar`,
    sha256: plugin.sha256,
  })),
  settings: requiredRuntimeSettings.map((file) => ({
    file,
    sha256: hash("3"),
  })),
  worldOverrides: { status: "absent", files: [] },
});

describe("capacity runtime identity", () => {
  it("binds every binary and configuration hash while canonicalizing file order", () => {
    const original = runtime();
    const fingerprint = runtimeFingerprint(original);
    expect(
      runtimeFingerprint({
        ...original,
        plugins: [...original.plugins].reverse(),
        settings: [...original.settings].reverse(),
      }),
    ).toBe(fingerprint);
    for (const field of [
      "paperSha256",
      "paperRuntimeSha256",
      "javaExecutableSha256",
      "javaReleaseSha256",
      "javaArgumentsSha256",
    ] as const) {
      expect(runtimeFingerprint({ ...original, [field]: hash("9") })).not.toBe(
        fingerprint,
      );
    }
    expect(
      runtimeFingerprint({ ...original, imageId: `sha256:${hash("9")}` }),
    ).not.toBe(fingerprint);
    const changed = runtime();
    const setting = changed.settings[0];
    if (setting === undefined) throw new Error("Missing fixture setting");
    setting.sha256 = hash("9");
    expect(runtimeFingerprint(changed)).not.toBe(fingerprint);
  });

  it("rejects contradictory duplicate files and credential-shaped extra fields", () => {
    const original = runtime();
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        plugins: [original.plugins[0], original.plugins[0]],
      }),
    ).toThrow();
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        settings: [original.settings[0], original.settings[0]],
      }),
    ).toThrow();
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        javaArguments: "raw arguments are forbidden",
      }),
    ).toThrow();
  });

  it("rejects missing required plugins/settings, changed plugin pins and undeclared world inventory", () => {
    const original = runtime();
    for (const file of requiredRuntimeSettings)
      expect(() =>
        RuntimeSchema.parse({
          ...original,
          settings: original.settings.filter((entry) => entry.file !== file),
        }),
      ).toThrow("settings inventory");
    for (const plugin of original.plugins)
      expect(() =>
        RuntimeSchema.parse({
          ...original,
          plugins: original.plugins.filter(
            (entry) => entry.file !== plugin.file,
          ),
        }),
      ).toThrow("plugin inventory");
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        plugins: original.plugins.map((entry, index) =>
          index === 0 ? { ...entry, sha256: hash("0") } : entry,
        ),
      }),
    ).toThrow("plugin inventory");
    const { worldOverrides: _world, ...old } = original;
    expect(() => RuntimeSchema.parse(old)).toThrow();
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        worldOverrides: { status: "present", files: [] },
      }),
    ).toThrow("world override inventory");
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        worldOverrides: {
          status: "absent",
          files: [{ file: "world/paper-world.yml", sha256: hash("4") }],
        },
      }),
    ).toThrow("world override inventory");
  });

  it("binds effective world overrides and canonicalizes their inventory without exposing file bytes", () => {
    const original = runtime();
    const worldOverrides = {
      status: "present",
      files: [
        { file: "world/paper-world.yml", sha256: hash("4") },
        { file: "rwf/paper-world.yml", sha256: hash("5") },
      ],
    };
    const withWorlds = { ...original, worldOverrides };
    const fingerprint = runtimeFingerprint(withWorlds);
    expect(fingerprint).not.toBe(runtimeFingerprint(original));
    expect(
      runtimeFingerprint({
        ...withWorlds,
        worldOverrides: {
          ...worldOverrides,
          files: [...worldOverrides.files].reverse(),
        },
      }),
    ).toBe(fingerprint);
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        worldOverrides: {
          status: "present",
          files: [worldOverrides.files[0], worldOverrides.files[0]],
        },
      }),
    ).toThrow();
  });
});
