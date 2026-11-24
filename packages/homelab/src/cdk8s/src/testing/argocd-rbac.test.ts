import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  argoRbacAllows,
  buildDirectSearchPath,
  resetNativeArgoCdCache,
  resolveNativeArgoCd,
  writeOfflineKubeconfig,
} from "./argocd-rbac.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
  resetNativeArgoCdCache();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirectories.push(dir);
  return dir;
}

describe("buildDirectSearchPath", () => {
  it("strips toolkit shims, mise shims, relative entries, and node_modules paths", () => {
    const home = "/Users/tester";
    const rawPath = [
      "",
      ".",
      "node_modules/@typescript/native/bin",
      `${home}/.local/share/toolkit/shims`,
      `${home}/.local/share/toolkit/shims/`,
      `${home}/.local/share/mise/shims`,
      "/other/user/.local/share/toolkit/shims",
      "/other/user/.local/share/mise/shims",
      "/repo/packages/homelab/node_modules/.bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
    ].join(path.delimiter);

    expect(buildDirectSearchPath(rawPath, home)).toBe(
      ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].join(path.delimiter),
    );
  });
});

describe("resolveNativeArgoCd", () => {
  it("prefers `mise which argocd` under the caller's real HOME", () => {
    const seen: { cwd: string; home: string | undefined }[] = [];
    const resolved = resolveNativeArgoCd({
      cwd: "/repo/packages/homelab/src/cdk8s/src/testing",
      env: {
        HOME: "/Users/real-operator",
        PATH: "/Users/real-operator/.local/share/toolkit/shims:/usr/bin",
      },
      spawnMiseWhich: ({ cwd, env }) => {
        seen.push({ cwd, home: env["HOME"] });
        return {
          exitCode: 0,
          stdout:
            "/Users/real-operator/.local/share/mise/installs/argo/3.5.4/bin/argocd\n",
        };
      },
      which: () => {
        throw new Error("fallback Bun.which must not run when mise succeeds");
      },
    });

    expect(resolved).toBe(
      "/Users/real-operator/.local/share/mise/installs/argo/3.5.4/bin/argocd",
    );
    expect(seen).toEqual([
      {
        cwd: "/repo/packages/homelab/src/cdk8s/src/testing",
        home: "/Users/real-operator",
      },
    ]);
  });

  it("falls back to scrubbed direct PATH lookup when mise fails or returns a shim", async () => {
    const root = await makeTempDir("argocd-rbac-resolve-");
    const fakeHome = path.join(root, "home");
    const toolkitShimDir = path.join(
      fakeHome,
      ".local",
      "share",
      "toolkit",
      "shims",
    );
    const miseShimDir = path.join(fakeHome, ".local", "share", "mise", "shims");
    const nodeModulesBin = path.join(root, "node_modules", ".bin");
    const nativeBinDir = path.join(root, "native-bin");
    for (const dir of [
      toolkitShimDir,
      miseShimDir,
      nodeModulesBin,
      nativeBinDir,
    ]) {
      await mkdir(dir, { recursive: true });
      const bin = path.join(dir, "argocd");
      await Bun.write(bin, "#!/bin/sh\nexit 0\n");
      await chmod(bin, 0o755);
    }

    const rawPath = [
      "relative/bin",
      toolkitShimDir,
      miseShimDir,
      nodeModulesBin,
      nativeBinDir,
    ].join(path.delimiter);

    const resolvedWhenMiseFails = resolveNativeArgoCd({
      cwd: root,
      env: { HOME: fakeHome, PATH: rawPath },
      spawnMiseWhich: () => ({ exitCode: 1, stdout: "" }),
    });
    expect(resolvedWhenMiseFails).toBe(path.join(nativeBinDir, "argocd"));

    const resolvedWhenMiseReturnsShim = resolveNativeArgoCd({
      cwd: root,
      env: { HOME: fakeHome, PATH: rawPath },
      spawnMiseWhich: () => ({
        exitCode: 0,
        stdout: `${path.join(toolkitShimDir, "argocd")}\n`,
      }),
    });
    expect(resolvedWhenMiseReturnsShim).toBe(path.join(nativeBinDir, "argocd"));
  });

  it("throws when neither mise nor scrubbed PATH provides native argocd", () => {
    expect(() =>
      resolveNativeArgoCd({
        cwd: "/",
        env: {
          HOME: "/Users/tester",
          PATH: "/Users/tester/.local/share/toolkit/shims",
        },
        spawnMiseWhich: () => ({ exitCode: 1, stdout: "" }),
        which: () => null,
      }),
    ).toThrow("Unable to resolve native argocd binary");
  });

  it("caches the resolved native argocd binary across default invocations", () => {
    const first = resolveNativeArgoCd();
    const second = resolveNativeArgoCd();
    expect(first).toBe(second);
    expect(path.isAbsolute(first)).toBe(true);
    expect(first).not.toContain("/toolkit/shims/");
    expect(first).not.toContain("/mise/shims/");
  });
});

describe("argoRbacAllows", () => {
  it("spawns the resolved binary with isolated PATH and scratch HOME", async () => {
    const root = await makeTempDir("argocd-rbac-exec-");
    const scratchHome = path.join(root, "scratch-home");
    const binDir = path.join(root, "bin");
    const logFile = path.join(root, "invocation.json");
    const executable = path.join(binDir, "argocd");
    await mkdir(scratchHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const kubeconfig = await writeOfflineKubeconfig(scratchHome);
    const policyFile = path.join(scratchHome, "policy.yaml");
    await Bun.write(policyFile, "apiVersion: v1\nkind: ConfigMap\n");

    await Bun.write(
      executable,
      String.raw`#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(logFile)}, JSON.stringify({
  args: process.argv.slice(2),
  path: process.env.PATH,
  home: process.env.HOME,
}));
process.stdout.write("Yes\n");
`,
    );
    await chmod(executable, 0o755);

    const allowed = await argoRbacAllows({
      subject: "delivery",
      action: "get",
      resource: "applications",
      object: "workloads/arcade",
      policyFile,
      kubeconfig,
      home: scratchHome,
      builtinPolicy: false,
      executable,
    });

    expect(allowed).toBe(true);
    const invocation = z
      .object({
        args: z.array(z.string()),
        path: z.string(),
        home: z.string(),
      })
      .parse(await Bun.file(logFile).json());
    expect(invocation.path).toBe(binDir);
    expect(invocation.home).toBe(scratchHome);
    expect(invocation.args).toEqual([
      "admin",
      "settings",
      "rbac",
      "can",
      "delivery",
      "get",
      "applications",
      "workloads/arcade",
      "--policy-file",
      policyFile,
      "--use-builtin-policy=false",
      "--kubeconfig",
      kubeconfig,
    ]);
  });
});
