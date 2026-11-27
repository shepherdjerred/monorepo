import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  asuswrtProviderInstallationConfig,
  asuswrtProviderPin,
  pinnedGoVersion,
  prepareAsuswrtProvider,
  resolveGoToolchainEnv,
} from "./asuswrt-provider.ts";

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await Bun.write(filePath, body);
  await chmod(filePath, 0o755);
}

describe("AsusWRT Go toolchain resolution", () => {
  test("reads the pinned Go version from .mise.toml", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "asuswrt-mise-toml-"));
    try {
      const customToml = path.join(fixture, ".mise.toml");
      await Bun.write(customToml, '[tools]\ngo = "1.27.2"\n');
      expect(await pinnedGoVersion(customToml)).toBe("go1.27.2");
      expect(await pinnedGoVersion()).toMatch(/^go\d+\.\d+\.\d+$/u);
      const pin = await asuswrtProviderPin();
      expect(pin.local).toBe(true);
      expect(
        asuswrtProviderInstallationConfig("/tmp/mirror", "example/asuswrt"),
      ).toContain('include = ["example/asuswrt"]');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("prepends mise which go ahead of ambient PATH and strips stale GOROOT", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "asuswrt-go-env-"));
    try {
      const ambientBin = path.join(fixture, "ambient-bin");
      const miseGoBin = path.join(fixture, "mise-go/bin");
      const gorootLog = path.join(fixture, "goroot.txt");
      await mkdir(ambientBin, { recursive: true });
      await mkdir(miseGoBin, { recursive: true });
      await Bun.write(
        path.join(fixture, ".mise.toml"),
        '[tools]\ngo = "1.27.2"\n',
      );

      // Ambient `go` reports the wrong version (`go1.27.4`), reproducing an
      // interactive Homebrew binary ahead of `mise` on PATH.
      await writeExecutable(
        path.join(ambientBin, "go"),
        "#!/bin/sh\necho go1.27.4\n",
      );
      await writeExecutable(
        path.join(ambientBin, "mise"),
        `#!/bin/sh\nif [ "$1" = "which" ] && [ "$2" = "go" ]; then\n  echo "${path.join(miseGoBin, "go")}"\n  exit 0\nfi\nexit 1\n`,
      );
      await writeExecutable(
        path.join(miseGoBin, "go"),
        `#!/bin/sh\nprintf '%s' "\${GOROOT:-unset}" > "${gorootLog}"\nif [ "$1" = "env" ] && [ "$2" = "GOVERSION" ]; then\n  echo go1.27.2\n  exit 0\nfi\nexit 1\n`,
      );

      const inputEnv = {
        PATH: `${ambientBin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
        GOROOT: "/stale/goroot/1.26.0",
        HOME: fixture,
      };
      const resolved = await resolveGoToolchainEnv(inputEnv, {
        repoRoot: fixture,
      });

      expect(resolved["GOROOT"]).toBeUndefined();
      expect(inputEnv.GOROOT).toBe("/stale/goroot/1.26.0");
      expect(
        resolved["PATH"]?.startsWith(`${miseGoBin}${path.delimiter}`),
      ).toBe(true);
      expect(await Bun.file(gorootLog).text()).toBe("unset");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("falls back to PATH go when mise is unavailable and fails fast on version mismatch", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "asuswrt-go-fallback-"));
    try {
      const binDir = path.join(fixture, "bin");
      await mkdir(binDir, { recursive: true });
      await Bun.write(
        path.join(fixture, ".mise.toml"),
        '[tools]\ngo = "1.27.4"\n',
      );
      await writeExecutable(
        path.join(binDir, "go"),
        '#!/bin/sh\nif [ "$1" = "env" ] && [ "$2" = "GOVERSION" ]; then\n  echo go1.27.4\n  exit 0\nfi\nexit 1\n',
      );

      const env = {
        PATH: `${binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
        GOROOT: "/stale/goroot",
      };
      const ok = await resolveGoToolchainEnv(env, { repoRoot: fixture });
      expect(ok["GOROOT"]).toBeUndefined();

      await expect(
        resolveGoToolchainEnv(env, {
          repoRoot: fixture,
          expectedGoVersion: "go1.27.2",
        }),
      ).rejects.toThrow(
        "Go toolchain version mismatch for AsusWRT provider: resolved go1.27.4, expected go1.27.2",
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("prepareAsuswrtProvider stages mirror binary and writes TF_CLI_CONFIG_FILE", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "asuswrt-prepare-"));
    let temporaryRoot: string | undefined;
    try {
      const binDir = path.join(fixture, "bin");
      await mkdir(binDir, { recursive: true });
      const expectedGo = await pinnedGoVersion();
      await writeExecutable(path.join(binDir, "mise"), "#!/bin/sh\nexit 1\n");
      await writeExecutable(
        path.join(binDir, "go"),
        [
          "#!/bin/sh",
          'if [ "$1" = "env" ] && [ "$2" = "GOVERSION" ]; then',
          `  echo "${expectedGo}"`,
          "  exit 0",
          "fi",
          'if [ "$1" = "env" ] && [ "$2" = "GOOS" ]; then echo linux; exit 0; fi',
          'if [ "$1" = "env" ] && [ "$2" = "GOARCH" ]; then echo arm64; exit 0; fi',
          'if [ "$1" = "build" ]; then',
          '  while [ "$#" -gt 0 ]; do',
          '    if [ "$1" = "-o" ]; then shift; printf "mock-provider" > "$1"; chmod 755 "$1"; exit 0; fi',
          "    shift",
          "  done",
          "fi",
          "exit 1",
          "",
        ].join("\n"),
      );
      const env: Record<string, string> = {
        PATH: `${binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
        GOROOT: "/stale/goroot",
        TMPDIR: fixture,
      };
      temporaryRoot = await prepareAsuswrtProvider(env);
      const pin = await asuswrtProviderPin();
      expect(env["TF_CLI_CONFIG_FILE"]).toBe(`${temporaryRoot}/tofu.tfrc`);
      expect(
        await Bun.file(
          `${temporaryRoot}/mirror/registry.opentofu.org/shepherdjerred/asuswrt/${pin.version}/linux_arm64/terraform-provider-asuswrt_v${pin.version}`,
        ).exists(),
      ).toBe(true);
    } finally {
      if (temporaryRoot !== undefined) {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
