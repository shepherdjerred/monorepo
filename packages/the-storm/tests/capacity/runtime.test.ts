import { describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runtimeFingerprint,
  RuntimeSchema,
  requiredRuntimeSettings,
  runtimePropertiesDigestCommand,
  runtimeJavaArgumentsDigestCommand,
  runtimeHeapFromFlags,
  verifyCapacityHeap,
  CapacityBootstrapSchema,
} from "./runtime.ts";
import { runtimeIdentityFixture as runtime } from "#capacity-fixtures/runtime-identity.ts";

const hash = (digit: string) => digit.repeat(64);

describe("capacity runtime identity", () => {
  it("parses only unambiguous actual heap flags and verifies the selected bootstrap", () => {
    const one = { initialBytes: 1024 ** 3, maxBytes: 8 * 1024 ** 3 };
    expect(runtimeHeapFromFlags(["-Xms1G", "-Xmx8G"])).toEqual(one);
    expect(runtimeHeapFromFlags(["-Xmx8192m", "-Xms1048576K"])).toEqual(one);
    expect(() =>
      verifyCapacityHeap({ initialHeap: "1G", source: "environment" }, one),
    ).not.toThrow();
    expect(() =>
      verifyCapacityHeap({ initialHeap: "8G", source: "default" }, one),
    ).toThrow("Actual JVM heap");
    expect(() =>
      verifyCapacityHeap(
        { initialHeap: "1G", source: "environment" },
        { ...one, maxBytes: 4 * 1024 ** 3 },
      ),
    ).toThrow("Actual JVM heap");
    expect(() =>
      CapacityBootstrapSchema.parse({ initialHeap: "1G", source: "default" }),
    ).toThrow();
    for (const flags of [
      ["-Xmx8G"],
      ["-Xms1G", "-Xms8G"],
      ["-Xms1G", "-Xmx8G", "-Xms8G"],
      ["-Xms9G", "-Xmx8G"],
      ["-Xms0G", "-Xmx8G"],
      ["-Xms-1G", "-Xmx8G"],
      ["-XmsNaN", "-Xmx8G"],
      ["-Xms999999999999999G", "-Xmx8G"],
    ])
      expect(() => runtimeHeapFromFlags(flags)).toThrow();
    const original = runtime();
    expect(runtimeFingerprint({ ...original, heap: one })).not.toBe(
      runtimeFingerprint(original),
    );
    const { heap: _heap, ...old } = original;
    expect(() => RuntimeSchema.parse(old)).toThrow();
  });
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

  it("rejects the old properties identity that bound a generated per-boot credential", () => {
    const original = runtime();
    expect(() =>
      RuntimeSchema.parse({
        ...original,
        settings: original.settings.map((entry) =>
          entry.file.startsWith("server.properties")
            ? {
                ...entry,
                file: "server.properties (without comments or rcon.password)",
              }
            : entry,
        ),
      }),
    ).toThrow("settings inventory");
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

async function propertyDigest(
  file: string,
  command = runtimePropertiesDigestCommand,
) {
  const child = Bun.spawn(["sh", "-c", command, "runtime-input", file], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  await new Response(child.stderr).text();
  return { exitCode: await child.exited, output };
}

it("canonicalizes only credentials/comments while binding enabled, physics and near-name settings", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rwf-runtime-properties-"),
  );
  const file = path.join(directory, "server.properties");
  const original = [
    "# generated boot comment",
    "rcon.password=synthetic-first-rcon",
    "management-server-secret=synthetic-first-management",
    "management-server-enabled=false",
    "view-distance=4",
    "rconXpassword=must-remain-bound",
    "management-server-secret-extra=must-remain-bound",
    "",
  ].join("\n");
  try {
    await Bun.write(file, original);
    const first = await propertyDigest(file);
    expect(first.exitCode).toBe(0);
    expect(first.output).toMatch(/^[a-f0-9]{64}\s/u);
    await Bun.write(
      file,
      original
        .replaceAll("synthetic-first", "synthetic-second")
        .replace("generated boot comment", "different boot comment"),
    );
    expect(await propertyDigest(file)).toEqual(first);
    await Bun.write(file, original.split("\n").reverse().join("\n"));
    expect(await propertyDigest(file)).toEqual(first);
    for (const changed of [
      original.replace("enabled=false", "enabled=true"),
      original.replace("distance=4", "distance=5"),
      original.replace("must-remain-bound", "changed-real-setting"),
      original.replace(
        "management-server-secret-extra=must-remain-bound",
        "management-server-secret-extra=changed-real-setting",
      ),
    ]) {
      await Bun.write(file, changed);
      const actual = await propertyDigest(file);
      expect(actual.exitCode).toBe(0);
      expect(actual.output).not.toBe(first.output);
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});

it("binds whole JVM arguments and rejects embedded newlines or failed/empty proc reads", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rwf-runtime-jvm-"));
  const file = path.join(directory, "cmdline");
  const original =
    ["java", "-XX:ActiveProcessorCount=4", "-Xms8G", "-Xmx8G", ""].join("\0") +
    "\0";
  const expected = "java\n-Xms8G\n-Xmx8G\n\n";
  try {
    await Bun.write(file, original);
    const first = await propertyDigest(file, runtimeJavaArgumentsDigestCommand);
    expect(first.exitCode).toBe(0);
    expect(first.output.split(/\s/u)[0]).toBe(
      new Bun.CryptoHasher("sha256").update(expected).digest("hex"),
    );
    await Bun.write(
      file,
      original.replace("ProcessorCount=4", "ProcessorCount=6"),
    );
    expect(
      await propertyDigest(file, runtimeJavaArgumentsDigestCommand),
    ).toEqual(first);
    await Bun.write(file, original.replace("-Xms8G", "-Xms1G"));
    const changed = await propertyDigest(
      file,
      runtimeJavaArgumentsDigestCommand,
    );
    expect(changed.output).not.toBe(first.output);
    await Bun.write(file, "java\0-Dreview=x\0-Xms8G\0");
    const plain = await propertyDigest(file, runtimeJavaArgumentsDigestCommand);
    expect(plain.exitCode).toBe(0);
    await Bun.write(
      file,
      "java\0-Dreview=x\n-XX:ActiveProcessorCount=4\0-Xms8G\0",
    );
    const embedded = await propertyDigest(
      file,
      runtimeJavaArgumentsDigestCommand,
    );
    expect(embedded.exitCode).not.toBe(0);
    expect(embedded.output).toBe("");
    await Bun.write(file, "");
    for (const invalid of [file, path.join(directory, "missing")]) {
      const actual = await propertyDigest(
        invalid,
        runtimeJavaArgumentsDigestCommand,
      );
      expect(actual.exitCode).not.toBe(0);
      expect(actual.output).toBe("");
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});

it("fails closed for missing, unreadable or empty properties instead of hashing empty input", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rwf-runtime-properties-"),
  );
  const invalid = path.join(directory, "directory-input");
  try {
    await mkdir(invalid);
    for (const file of [path.join(directory, "missing.properties"), invalid]) {
      const actual = await propertyDigest(file);
      expect(actual.exitCode).not.toBe(0);
      expect(actual.output).toBe("");
    }
    const empty = path.join(directory, "empty.properties");
    await Bun.write(
      empty,
      "# comments and credentials are not a configuration\nrcon.password=synthetic\n",
    );
    const actual = await propertyDigest(empty);
    expect(actual.exitCode).not.toBe(0);
    expect(actual.output).toBe("");
  } finally {
    await rm(directory, { recursive: true });
  }
});
