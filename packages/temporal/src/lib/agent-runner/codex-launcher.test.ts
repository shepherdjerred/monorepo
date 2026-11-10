import { afterEach, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { providerPathOverride } from "./codex-launcher.ts";

afterEach(() => vi.unstubAllEnvs());

test.each(["app-server", "schema-validation"])(
  "keeps %s helper startup outside provider Bun configuration",
  async (kind) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "codex-config-test-"),
    );
    let wrapperDirectory: string | undefined;
    try {
      const workspace = path.join(directory, "workspace");
      const home = path.join(directory, "home");
      const config = path.join(directory, "config");
      const bin = path.join(directory, "bin");
      await Promise.all(
        [workspace, home, config, bin].map((entry) => mkdir(entry)),
      );
      const marker = path.join(directory, "preload-ran");
      const preload = path.join(directory, "untrusted-preload.ts");
      await writeFile(
        preload,
        `await Bun.write(${JSON.stringify(marker)}, "executed"); throw new Error("Untrusted preload executed");`,
      );
      const bunfig = `preload = [${JSON.stringify(preload)}]\n`;
      await Promise.all([
        writeFile(path.join(workspace, "bunfig.toml"), bunfig),
        writeFile(path.join(home, ".bunfig.toml"), bunfig),
        writeFile(path.join(config, "bunfig.toml"), bunfig),
        writeFile(
          path.join(workspace, ".env"),
          `BUN_OPTIONS="--preload ${preload}"\n`,
        ),
      ]);
      // Emulate only the final uid tool so this regression also runs on macOS.
      // The privileged schema helper executes the actual installed Bun runtime.
      await writeFile(
        path.join(bin, "setpriv"),
        '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n',
        { mode: 0o755 },
      );
      const provider = path.join(directory, "provider");
      await writeFile(
        provider,
        '#!/bin/sh\nprintf "%s\\n" "$PWD" "$HOME" "$XDG_CONFIG_HOME" "$BUN_OPTIONS" "$NODE_OPTIONS" "$@"\n',
        { mode: 0o755 },
      );
      vi.stubEnv("AGENT_PROVIDER_UID", "1001");
      const launcher = await providerPathOverride({
        codexPathOverride: provider,
      });
      wrapperDirectory = launcher.wrapperDirectory;
      const executable = launcher.pathOverride?.codexPathOverride;
      if (executable === undefined)
        throw new Error("Missing isolated launcher");
      const arguments_ =
        kind === "app-server"
          ? ["app-server"]
          : ["exec", "--output-schema", path.join(workspace, "schema.json")];
      const child = Bun.spawn([executable, ...arguments_], {
        cwd: workspace,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: home,
          XDG_CONFIG_HOME: config,
          BUN_OPTIONS: `--preload ${preload}`,
          NODE_OPTIONS: `--require ${preload}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(await Bun.file(marker).exists()).toBe(false);
      if (kind === "app-server") {
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(stdout.trim().split("\n")).toEqual([
          await realpath(workspace),
          home,
          config,
          `--preload ${preload}`,
          `--require ${preload}`,
          "app-server",
        ]);
      } else {
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("SDK temporary directory");
        expect(stdout).toBe("");
      }
    } finally {
      if (wrapperDirectory !== undefined)
        await rm(wrapperDirectory, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
