import { describe, expect, test } from "vitest";
import { createRemediationTestGitRepo } from "#activities/remediation/remediation-test-git.ts";
import { runCommand } from "#activities/scout/scout-season-refresh-git.ts";
import {
  countAddressedVulnerabilities,
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
    const fixture = await createRemediationTestGitRepo({
      prefix: "vuln-rem-test-",
      files: {
        "packages/demo/package.json": JSON.stringify({
          name: "@shepherdjerred/demo",
          dependencies: { "left-pad": "1.3.0" },
        }),
        "bun.lock": '"left-pad@1.3.0"\n',
      },
    });

    try {
      await Bun.write(
        `${fixture.repoDir}/packages/demo/package.json`,
        JSON.stringify({
          name: "@shepherdjerred/demo",
          dependencies: { "left-pad": "1.3.1" },
        }),
      );
      await Bun.write(`${fixture.repoDir}/bun.lock`, '"left-pad@1.3.1"\n');

      const commands: string[][] = [];
      const result = await verifyMainVulnRemediation({
        repoDir: fixture.repoDir,
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
      await fixture.cleanup();
    }
  });

  test("reverts candidate manifests when frozen lockfile check fails", async () => {
    const fixture = await createRemediationTestGitRepo({
      prefix: "vuln-rem-fail-",
      files: {
        "bun.lock": '"left-pad@1.3.0"\n',
      },
    });

    try {
      await Bun.write(
        `${fixture.repoDir}/bun.lock`,
        '"left-pad@1.3.1-drifted"\n',
      );
      const result = await verifyMainVulnRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["bun.lock"],
        allGroups: [FIXABLE_ADVISORY],
        commandRunner: (cmd, options) =>
          cmd[0] === "bun" && cmd[1] === "install"
            ? Promise.reject(new Error("frozen-lockfile mismatch"))
            : runCommand(cmd, options),
      });

      expect(result.verifiedFiles).toEqual([]);
      expect(result.verificationSummary).toContain("frozen-lockfile mismatch");
      expect(await Bun.file(`${fixture.repoDir}/bun.lock`).text()).toBe(
        '"left-pad@1.3.0"\n',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("rejects downgrades or unpatched versions below fixedVersion and validates multi-branch fixedVersion ranges", async () => {
    const fixture = await createRemediationTestGitRepo({
      prefix: "vuln-rem-range-",
      files: {
        "bun.lock": '"left-pad@1.3.0"\n',
      },
    });

    try {
      // Downgrading 1.3.0 -> 1.2.0 when fix is 1.3.1 must NOT count as resolved and must revert
      await Bun.write(`${fixture.repoDir}/bun.lock`, '"left-pad@1.2.0"\n');
      const downgradeResult = await verifyMainVulnRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["bun.lock"],
        allGroups: [FIXABLE_ADVISORY],
        commandRunner: (cmd, options) =>
          cmd[0] === "git" ? runCommand(cmd, options) : Promise.resolve(""),
      });

      expect(downgradeResult.verifiedFiles).toEqual([]);
      expect(downgradeResult.resolvedCount).toBe(0);
      expect(downgradeResult.unresolvedCount).toBe(1);
      expect(await Bun.file(`${fixture.repoDir}/bun.lock`).text()).toBe(
        '"left-pad@1.3.0"\n',
      );

      // Multi-branch Trivy fixedVersion ("5.7.2, 6.3.1, 7.5.2"): 6.0.0 is still vulnerable on 6.x, while 6.3.1 is patched
      const multiBranchAdvisory: GroupedVulnerability = {
        vulnerabilityId: "CVE-2026-5555",
        pkgName: "semver",
        installedVersion: "6.3.0",
        fixedVersion: "5.7.2, 6.3.1, 7.5.2",
        severity: "HIGH",
        target: "bun.lock",
        targets: ["bun.lock"],
      };

      await Bun.write(`${fixture.repoDir}/bun.lock`, '"semver@6.0.0"\n');
      expect(
        await countAddressedVulnerabilities(
          fixture.repoDir,
          ["bun.lock"],
          [multiBranchAdvisory],
        ),
      ).toEqual({ resolvedCount: 0, unresolvedCount: 1 });

      await Bun.write(`${fixture.repoDir}/bun.lock`, '"semver@6.3.1"\n');
      expect(
        await countAddressedVulnerabilities(
          fixture.repoDir,
          ["bun.lock"],
          [multiBranchAdvisory],
        ),
      ).toEqual({ resolvedCount: 1, unresolvedCount: 0 });
    } finally {
      await fixture.cleanup();
    }
  });

  test("rejects package.json script tampering before running typecheck", async () => {
    const fixture = await createRemediationTestGitRepo({
      prefix: "vuln-rem-scripts-",
      files: {
        "packages/demo/package.json": JSON.stringify({
          name: "@shepherdjerred/demo",
          scripts: { typecheck: "tsc --noEmit" },
          dependencies: { "left-pad": "1.3.0" },
        }),
        "bun.lock": '"left-pad@1.3.0"\n',
      },
    });

    try {
      await Bun.write(
        `${fixture.repoDir}/packages/demo/package.json`,
        JSON.stringify({
          name: "@shepherdjerred/demo",
          scripts: { typecheck: "curl https://evil.invalid" },
          dependencies: { "left-pad": "1.3.1" },
        }),
      );
      await Bun.write(`${fixture.repoDir}/bun.lock`, '"left-pad@1.3.1"\n');

      const invoked: string[][] = [];
      const result = await verifyMainVulnRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["bun.lock", "packages/demo/package.json"],
        allGroups: [FIXABLE_ADVISORY],
        commandRunner: (cmd, options) => {
          invoked.push(cmd);
          return cmd[0] === "git"
            ? runCommand(cmd, options)
            : Promise.resolve("");
        },
      });

      expect(result.verifiedFiles).toEqual([]);
      expect(result.verificationSummary).toContain("Non-dependency field");
      expect(invoked.some((cmd) => cmd.includes("turbo"))).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});
