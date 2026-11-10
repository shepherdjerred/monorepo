import { describe, expect, test } from "vitest";
import path from "node:path";
import { z } from "zod/v4";
import {
  assertCodexBubblewrapDigest,
  assertCodexPackageVersion,
  assertRootProtectedMetadata,
  codexBubblewrapPin,
} from "./codex-bubblewrap.ts";
import { codexLauncherPath } from "./codex-launcher.ts";
import { LinuxSandboxHelperSchema } from "./contract.ts";
import pins from "./codex-bubblewrap-pins.json" with { type: "json" };

describe("pinned official Codex bubblewrap artifacts", () => {
  test("helper pins follow both active CLI and SDK manifests and the node profile provenance", async () => {
    const source = z
      .object({ dependencies: z.object({ "@openai/codex-sdk": z.string() }) })
      .parse(
        await Bun.file(
          new URL("../../../package.json", import.meta.url),
        ).json(),
      );
    const cli = z
      .object({ name: z.string(), version: z.string() })
      .parse(
        await Bun.file(
          path.join(
            path.dirname(path.dirname(codexLauncherPath())),
            "package.json",
          ),
        ).json(),
      );
    const policy = z
      .object({ codexVersion: z.string() })
      .parse(
        await Bun.file(
          new URL(
            "../../../../homelab/src/talos/seccomp/promotion-policy.json",
            import.meta.url,
          ),
        ).json(),
      );
    expect(cli.name).toBe("@openai/codex");
    expect(cli.version).toBe(pins.codexVersion);
    expect(source.dependencies["@openai/codex-sdk"]).toBe(pins.codexVersion);
    expect(policy.codexVersion).toBe(pins.codexVersion);
    const lock = await Bun.file(
      new URL("../../../../../bun.lock", import.meta.url),
    ).text();
    for (const architecture of ["arm64", "x64"]) {
      const pin = codexBubblewrapPin(architecture);
      expect(pin.package).toBe(`@openai/codex-linux-${architecture}`);
      expect(pin.packageVersion).toBe(
        `${pins.codexVersion}-linux-${architecture}`,
      );
      expect(lock).toContain(
        `"${pin.package}": ["@openai/codex@${pin.packageVersion}"`,
      );
      expect(lock).toContain(pin.packageIntegrity);
    }
  });

  test("unknown selection and architectures fail closed", () => {
    expect(LinuxSandboxHelperSchema.parse("bundled-codex")).toBe(
      "bundled-codex",
    );
    expect(() => LinuxSandboxHelperSchema.parse("system")).toThrow();
    expect(() => codexBubblewrapPin("ia32")).toThrow("Unsupported");
  });

  test("pins cannot be mutated by a caller", () => {
    const pin = codexBubblewrapPin("arm64");
    expect(Object.isFrozen(pin)).toBe(true);
    expect(Reflect.set(pin, "helperSha256", "unreviewed")).toBe(false);
    expect(codexBubblewrapPin("arm64").helperSha256).toBe(
      pins.platforms.arm64.helperSha256,
    );
  });

  test.each(["arm64", "x64"])(
    "verifies exact architecture-specific helper bytes for %s",
    (architecture) => {
      const pin = codexBubblewrapPin(architecture);
      expect(() =>
        assertCodexBubblewrapDigest(pin.helperSha256, architecture),
      ).not.toThrow();
      expect(() =>
        assertCodexBubblewrapDigest("0".repeat(64), architecture),
      ).toThrow("digest differs");
      const other = codexBubblewrapPin(
        architecture === "arm64" ? "x64" : "arm64",
      );
      expect(() =>
        assertCodexBubblewrapDigest(other.helperSha256, architecture),
      ).toThrow("digest differs");
    },
  );

  test("CLI and platform manifests both require their precise pinned version", () => {
    for (const expected of [
      pins.codexVersion,
      pins.platforms.arm64.packageVersion,
    ]) {
      expect(() =>
        assertCodexPackageVersion(
          { name: "@openai/codex", version: expected },
          expected,
        ),
      ).not.toThrow();
      expect(() =>
        assertCodexPackageVersion(
          { name: "@openai/codex", version: "0.0.0" },
          expected,
        ),
      ).toThrow("version differs");
      expect(() =>
        assertCodexPackageVersion(
          { name: "unrelated", version: expected },
          expected,
        ),
      ).toThrow();
    }
  });
});

describe("provider-resistant helper ownership", () => {
  test.each([
    { uid: 1001, mode: 0o755 },
    { uid: 0, mode: 0o775 },
    { uid: 0, mode: 0o777 },
  ])("rejects mutable ownership/mode %j", (metadata) => {
    expect(() => assertRootProtectedMetadata(metadata)).toThrow(
      "provider writes",
    );
  });

  test("accepts immutable root paths and only root-owned sticky writable ancestors", () => {
    expect(() =>
      assertRootProtectedMetadata({ uid: 0, mode: 0o755 }),
    ).not.toThrow();
    expect(() =>
      assertRootProtectedMetadata({ uid: 0, mode: 0o1777 }, true),
    ).not.toThrow();
    expect(() =>
      assertRootProtectedMetadata({ uid: 0, mode: 0o1777 }),
    ).toThrow();
    expect(() =>
      assertRootProtectedMetadata({ uid: 1001, mode: 0o1777 }, true),
    ).toThrow();
    expect(() =>
      assertRootProtectedMetadata({ uid: 0, mode: 0o777 }, true),
    ).toThrow();
  });
});
