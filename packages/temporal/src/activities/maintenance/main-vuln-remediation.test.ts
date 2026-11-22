import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { describe, expect, test } from "vitest";
import { runCommand } from "#activities/scout/scout-season-refresh-git.ts";
import {
  isAllowedMainVulnPath,
  verifyMainVulnRemediation,
} from "./main-vuln-remediation.ts";
import type { GroupedVulnerability } from "./main-vuln-scan-report.ts";

const FIXABLE_ADVISORY: GroupedVulnerability = {
  vulnerabilityId: "CVE-2026-1234",
  pkgName: "left-pad",
  installedVersion: "1.3.0",
  fixedVersion: "1.3.1",
  severity: "CRITICAL",
  target: "bun.lock",
  targets: ["bun.lock"],
  title: "left-pad RCE",
};

const UNFIXABLE_ADVISORY: GroupedVulnerability = {
  vulnerabilityId: "CVE-2026-9999",
  pkgName: "chalk",
  installedVersion: "5.0.0",
  severity: "HIGH",
  target: "bun.lock",
  targets: ["bun.lock"],
};

describe("isAllowedMainVulnPath", () => {
  test("allows manifests, lockfiles, and catalog.json while strictly rejecting .trivyignore and source files", () => {
    expect(isAllowedMainVulnPath("package.json")).toBe(true);
    expect(isAllowedMainVulnPath("packages/temporal/package.json")).toBe(true);
    expect(isAllowedMainVulnPath("bun.lock")).toBe(true);
    expect(isAllowedMainVulnPath("packages/foo/Cargo.toml")).toBe(true);
    expect(isAllowedMainVulnPath("Cargo.lock")).toBe(true);
    expect(isAllowedMainVulnPath("packages/go-app/go.mod")).toBe(true);
    expect(isAllowedMainVulnPath("packages/go-app/go.sum")).toBe(true);
    expect(isAllowedMainVulnPath("packages/py/pyproject.toml")).toBe(true);
    expect(isAllowedMainVulnPath("packages/py/uv.lock")).toBe(true);
    expect(
      isAllowedMainVulnPath("packages/version-catalog/src/catalog.json"),
    ).toBe(true);

    expect(isAllowedMainVulnPath(".trivyignore")).toBe(false);
    expect(isAllowedMainVulnPath("packages/foo/.trivyignore")).toBe(false);
    expect(isAllowedMainVulnPath("node_modules/pkg/package.json")).toBe(false);
    expect(isAllowedMainVulnPath("sandbox/archive/package.json")).toBe(false);
    expect(isAllowedMainVulnPath("packages/temporal/src/index.ts")).toBe(false);
  });
});

describe("verifyMainVulnRemediation", () => {
  test("verifies frozen lockfile + touched workspace typecheck and leaves autoMerge false", async () => {
    const tempDir = await mkdtemp(nodePath.join(tmpdir(), "vuln-rem-test-"));
    const repoDir = `${tempDir}/repo`;
    await runCommand(["mkdir", "-p", `${repoDir}/packages/demo`], {
      cwd: tempDir,
    });
    await runCommand(["git", "init", "-b", "main"], { cwd: repoDir });
    await runCommand(["git", "config", "user.email", "test@sjer.red"], {
      cwd: repoDir,
    });
    await runCommand(["git", "config", "user.name", "Test"], { cwd: repoDir });
    await Bun.write(
      `${repoDir}/packages/demo/package.json`,
      JSON.stringify({
        name: "@shepherdjerred/demo",
        dependencies: { "left-pad": "1.3.0" },
      }),
    );
    await Bun.write(`${repoDir}/bun.lock`, '"left-pad@1.3.0"\n');
    await runCommand(["git", "add", "."], { cwd: repoDir });
    await runCommand(["git", "commit", "-m", "init"], { cwd: repoDir });

    try {
      await Bun.write(
        `${repoDir}/packages/demo/package.json`,
        JSON.stringify({
          name: "@shepherdjerred/demo",
          dependencies: { "left-pad": "1.3.1" },
        }),
      );
      await Bun.write(`${repoDir}/bun.lock`, '"left-pad@1.3.1"\n');

      const commands: string[][] = [];
      const result = await verifyMainVulnRemediation({
        repoDir,
        changedFiles: ["bun.lock", "packages/demo/package.json"],
        allGroups: [FIXABLE_ADVISORY, UNFIXABLE_ADVISORY],
        commandRunner: (cmd) => {
          commands.push(cmd);
          return Promise.resolve("");
        },
      });

      expect(result).toMatchObject({
        verifiedFiles: ["bun.lock", "packages/demo/package.json"],
        resolvedCount: 1,
        unresolvedCount: 1,
        autoMerge: false,
      });
      expect(commands).toContainEqual([
        "bun",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
      ]);
      expect(commands).toContainEqual([
        "bunx",
        "--no-install",
        "turbo",
        "run",
        "typecheck",
        "--filter=@shepherdjerred/demo",
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("reverts candidate manifests when frozen lockfile check fails", async () => {
    const tempDir = await mkdtemp(nodePath.join(tmpdir(), "vuln-rem-fail-"));
    const repoDir = `${tempDir}/repo`;
    await runCommand(["mkdir", "-p", repoDir], { cwd: tempDir });
    await runCommand(["git", "init", "-b", "main"], { cwd: repoDir });
    await runCommand(["git", "config", "user.email", "test@sjer.red"], {
      cwd: repoDir,
    });
    await runCommand(["git", "config", "user.name", "Test"], { cwd: repoDir });
    await Bun.write(`${repoDir}/bun.lock`, '"left-pad@1.3.0"\n');
    await runCommand(["git", "add", "."], { cwd: repoDir });
    await runCommand(["git", "commit", "-m", "init"], { cwd: repoDir });

    try {
      await Bun.write(`${repoDir}/bun.lock`, '"left-pad@1.3.1-drifted"\n');
      const result = await verifyMainVulnRemediation({
        repoDir,
        changedFiles: ["bun.lock"],
        allGroups: [FIXABLE_ADVISORY],
        commandRunner: (cmd, options) =>
          cmd[0] === "bun" && cmd[1] === "install"
            ? Promise.reject(new Error("frozen-lockfile mismatch"))
            : runCommand(cmd, options),
      });

      expect(result.verifiedFiles).toEqual([]);
      expect(result.verificationSummary).toContain("frozen-lockfile mismatch");
      expect(await Bun.file(`${repoDir}/bun.lock`).text()).toBe(
        '"left-pad@1.3.0"\n',
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
