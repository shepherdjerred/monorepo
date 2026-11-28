import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { baseConfig } from "./base.ts";
import { computeDependencyTopologyHash } from "./dependency-topology.ts";

const tempDirectories: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "eslint-dep-topology-"));
  tempDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const dir = tempDirectories.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("computeDependencyTopologyHash", () => {
  test("returns a stable SHA-256 digest when dependency links do not change", async () => {
    const root = await createTempWorkspace();
    const targetPkg = path.join(root, "packages", "s3-signed-request");
    const scriptsDir = path.join(root, "scripts");
    await mkdir(targetPkg, { recursive: true });
    await mkdir(path.join(scriptsDir, "node_modules", "@shepherdjerred"), {
      recursive: true,
    });
    await writeFile(
      path.join(scriptsDir, "package.json"),
      JSON.stringify({
        name: "@shepherdjerred/root-scripts",
        dependencies: {
          "@shepherdjerred/s3-signed-request": "workspace:*",
          zod: "^4.4.3",
        },
      }),
    );
    await symlink(
      "../../../packages/s3-signed-request",
      path.join(
        scriptsDir,
        "node_modules",
        "@shepherdjerred",
        "s3-signed-request",
      ),
    );

    const first = computeDependencyTopologyHash(scriptsDir);
    const second = computeDependencyTopologyHash(scriptsDir);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  test("invalidates hash when a missing workspace symlink is installed", async () => {
    const root = await createTempWorkspace();
    const targetPkg = path.join(root, "packages", "s3-signed-request");
    const scriptsDir = path.join(root, "scripts");
    const scopeDir = path.join(scriptsDir, "node_modules", "@shepherdjerred");
    await mkdir(targetPkg, { recursive: true });
    await mkdir(scopeDir, { recursive: true });
    await writeFile(
      path.join(scriptsDir, "package.json"),
      JSON.stringify({
        name: "@shepherdjerred/root-scripts",
        dependencies: {
          "@shepherdjerred/s3-signed-request": "workspace:*",
          zod: "^4.4.3",
        },
      }),
    );

    const beforeInstall = computeDependencyTopologyHash(scriptsDir);

    await symlink(
      "../../../packages/s3-signed-request",
      path.join(scopeDir, "s3-signed-request"),
    );

    const afterInstall = computeDependencyTopologyHash(scriptsDir);
    expect(afterInstall).not.toBe(beforeInstall);
  });

  test("invalidates hash when a symlink retargets or transitions from dangling to valid", async () => {
    const root = await createTempWorkspace();
    const pkgDir = path.join(root, "packages", "app");
    const storeV1 = path.join(root, "node_modules", ".bun", "dep@1.0.0+aaa");
    const storeV2 = path.join(root, "node_modules", ".bun", "dep@1.0.0+bbb");
    const linkPath = path.join(pkgDir, "node_modules", "dep");
    await mkdir(path.join(pkgDir, "node_modules"), { recursive: true });
    await writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@shepherdjerred/app",
        devDependencies: { dep: "1.0.0" },
      }),
    );

    await symlink(storeV1, linkPath);
    const danglingHash = computeDependencyTopologyHash(pkgDir);

    await mkdir(storeV1, { recursive: true });
    const resolvedV1Hash = computeDependencyTopologyHash(pkgDir);
    expect(resolvedV1Hash).not.toBe(danglingHash);

    await mkdir(storeV2, { recursive: true });
    await unlink(linkPath);
    await symlink(storeV2, linkPath);
    const resolvedV2Hash = computeDependencyTopologyHash(pkgDir);
    expect(resolvedV2Hash).not.toBe(resolvedV1Hash);
  });

  test("handles directories without package.json and wires into baseConfig settings", async () => {
    const emptyDir = await createTempWorkspace();
    const emptyHash = computeDependencyTopologyHash(emptyDir);
    expect(emptyHash).toMatch(/^[a-f0-9]{64}$/);

    const configs = baseConfig({ tsconfigRootDir: emptyDir });
    const settingsEntry = configs.find(
      (entry) =>
        entry.settings?.["@shepherdjerred/dependency-topology"] !== undefined,
    );
    expect(
      settingsEntry?.settings?.["@shepherdjerred/dependency-topology"],
    ).toBe(emptyHash);
  });
});
