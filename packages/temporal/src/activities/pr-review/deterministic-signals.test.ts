import { describe, expect, it } from "bun:test";
import type { BootstrapResult } from "./bootstrap.ts";
import { runDeterministicSignals } from "./deterministic-signals.ts";

const EMPTY_CONTEXT: BootstrapResult = {
  workdir: "/tmp/repo",
  changedFiles: [],
  claudeMdHierarchy: [],
  retrievedSymbols: [],
  blockDiffs: [],
  skipReviewReason: null,
};

describe("runDeterministicSignals — container image refs", () => {
  it("emits a critical verified finding when a changed GHCR image tag is missing", async () => {
    const context: BootstrapResult = {
      ...EMPTY_CONTEXT,
      changedFiles: [
        {
          path: "packages/homelab/src/cdk8s/src/versions.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: [
            "@@ -201,7 +201,7 @@ const versions = {",
            "   // not managed by renovate",
            '   "shepherdjerred/caddy-s3proxy":',
            '-    "2.0.0-2473@sha256:old",',
            '+    "2.0.0-9999@sha256:new",',
          ].join("\n"),
        },
      ],
    };

    const findings = await runDeterministicSignals(contextInput(context), {
      checkImageManifest: async (input) => {
        expect(input.registry).toBe("ghcr.io");
        expect(input.repository).toBe("shepherdjerred/caddy-s3proxy");
        expect(input.reference).toBe("2.0.0-9999");
        return "missing";
      },
    });

    expect(findings).toHaveLength(2);
    const first = findings[0]?.finding;
    expect(first?.severity).toBe("critical");
    expect(first?.kind).toBe("deps");
    expect(first?.verifier).toBe("container-image");
    expect(first?.claim).toContain("not published");
    expect(first?.verification?.status).toBe("verified");
  });

  it("does not emit a finding when the changed image tag exists", async () => {
    const context: BootstrapResult = {
      ...EMPTY_CONTEXT,
      changedFiles: [
        {
          path: "packages/homelab/src/cdk8s/src/versions.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch:
            '@@ -1,1 +1,1 @@\n+  "shepherdjerred/obsidian-headless": "2.0.0-2473@sha256:abc",',
        },
      ],
    };

    const findings = await runDeterministicSignals(contextInput(context), {
      checkImageManifest: () => Promise.resolve("exists"),
    });

    expect(findings).toEqual([]);
  });
});

describe("runDeterministicSignals — native peer checker bypass", () => {
  it("flags a checker that lets devDependencies satisfy runtime peers", async () => {
    const context: BootstrapResult = {
      ...EMPTY_CONTEXT,
      changedFiles: [
        {
          path: "packages/tasks-for-obsidian/scripts/check-ios-native-deps.ts",
          status: "modified",
          additions: 8,
          deletions: 0,
          patch: [
            "@@ -98,6 +98,14 @@",
            "+const runtimeDependencyNames = dependencyNames(appPackageJson, [",
            '+  "dependencies",',
            "+]);",
            "+const declaredPackageNames = dependencyNames(appPackageJson, [",
            '+  "dependencies",',
            '+  "devDependencies",',
            '+  "optionalDependencies",',
            "+]);",
            "+if (declaredPackageNames.has(peerName)) continue;",
          ].join("\n"),
        },
      ],
    };

    const findings = await runDeterministicSignals(contextInput(context), {
      checkImageManifest: () => Promise.resolve("unknown"),
    });

    expect(findings).toHaveLength(2);
    const first = findings[0]?.finding;
    expect(first?.kind).toBe("correctness");
    expect(first?.claim).toContain("non-runtime dependency sections");
    expect(first?.verifier).toBe("grep");
    expect(first?.lineStart).toBe(106);
    expect(first?.suggestion).toEqual({
      replacement: "if (runtimeDependencyNames.has(peerName)) continue;",
      lineStart: 106,
      lineEnd: 106,
      rationale:
        "The runtime peer check should only be satisfied by packages present in runtime dependencies.",
    });
  });

  it("does not flag test fixtures containing the bypass snippet", async () => {
    const context: BootstrapResult = {
      ...EMPTY_CONTEXT,
      changedFiles: [
        {
          path: "packages/temporal/src/activities/pr-review/deterministic-signals.test.ts",
          status: "modified",
          additions: 8,
          deletions: 0,
          patch: [
            "@@ -98,6 +98,14 @@",
            "+const runtimeDependencyNames = dependencyNames(appPackageJson, [",
            '+  "dependencies",',
            "+]);",
            "+const declaredPackageNames = dependencyNames(appPackageJson, [",
            '+  "dependencies",',
            '+  "devDependencies",',
            '+  "optionalDependencies",',
            "+]);",
            "+if (declaredPackageNames.has(peerName)) continue;",
          ].join("\n"),
        },
      ],
    };

    const findings = await runDeterministicSignals(contextInput(context), {
      checkImageManifest: () => Promise.resolve("unknown"),
    });

    expect(findings).toEqual([]);
  });
});

function contextInput(context: BootstrapResult): { context: BootstrapResult } {
  return { context };
}
