import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  extractArg,
  formatToolchainReport,
  GLOBAL_JSON_PATH,
  loadAndValidateToolchainSync,
  MACOS_DOCKERFILE,
  MiseToolsSchema,
  TEMPORAL_DOCKERFILE,
  validateToolchainVersionSync,
  WINDOWS_DOCKERFILE,
  type ToolchainSyncInputs,
} from "./check-toolchain-version-sync.ts";

const repoRoot = path.resolve(import.meta.dir, "../../..");

function validFixture(): ToolchainSyncInputs {
  return {
    miseConfig: {
      tools: {
        rust: "1.100.0",
        dotnet: "10.0.404",
        opentofu: "1.13.9",
        argocd: "3.6.2",
        gh: "2.105.0",
        lychee: "0.24.2",
        "aqua:temporalio/cli": "1.10.1",
        "github:theseus-rs/postgresql-binaries": {
          version: "18.7.0",
          strip_components: 1,
          bin_path: "bin",
        },
      },
    },
    globalJson: { sdk: { version: "10.0.404" } },
    macosDockerfile: "ARG RUST_VERSION=1.100.0\n",
    windowsDockerfile:
      "ARG RUST_VERSION=1.100.0\nARG DOTNET_SDK_VERSION=10.0.404\n",
    temporalDockerfile: [
      "ARG GH_CLI_VERSION=2.105.0",
      "ARG TOFU_VERSION=1.13.9",
      "ARG ARGOCD_CLI_VERSION=v3.6.2",
      "ARG TEMPORAL_CLI_VERSION=1.10.1",
      "ARG LYCHEE_VERSION=lychee-v0.24.2",
      "ARG POSTGRESQL_BINARIES_VERSION=18.7.0",
    ].join("\n"),
  };
}

describe("check-toolchain-version-sync", () => {
  test("passes on the live repository files", async () => {
    const { tools, violations } = await loadAndValidateToolchainSync(repoRoot);
    expect(violations).toEqual([]);
    const okReport = formatToolchainReport(tools, violations);
    expect(okReport.ok).toBe(true);
    expect(okReport.output).toContain(`argocd=${tools.argocd}`);
  });

  test("extracts numeric and prefixed ARG values", () => {
    const dockerfile =
      "ARG ARGOCD_CLI_VERSION=v3.6.2\nARG LYCHEE_VERSION=lychee-v0.24.2\nARG TOFU_VERSION=1.13.9\n";
    expect(extractArg(dockerfile, "ARGOCD_CLI_VERSION")).toBe("v3.6.2");
    expect(extractArg(dockerfile, "LYCHEE_VERSION")).toBe("lychee-v0.24.2");
    expect(extractArg(dockerfile, "TOFU_VERSION")).toBe("1.13.9");
    expect(extractArg(dockerfile, "MISSING_ARG")).toBeUndefined();
  });

  test("reports Argo CD and Temporal operator CLI version drift against .mise.toml", () => {
    const fixture = validFixture();
    fixture.temporalDockerfile = [
      "ARG GH_CLI_VERSION=2.104.0",
      "ARG TOFU_VERSION=1.13.8",
      "ARG ARGOCD_CLI_VERSION=v3.4.5",
      "ARG TEMPORAL_CLI_VERSION=1.9.0",
      "ARG LYCHEE_VERSION=lychee-v0.24.1",
      "ARG POSTGRESQL_BINARIES_VERSION=18.6.0",
    ].join("\n");

    const violations = validateToolchainVersionSync(fixture);
    const parsedTools = MiseToolsSchema.parse(fixture.miseConfig).tools;
    const failureReport = formatToolchainReport(parsedTools, violations);
    expect(failureReport.ok).toBe(false);
    expect(failureReport.output).toContain("6 violation(s) found.");
    expect(violations).toHaveLength(6);
    expect(violations).toContainEqual({
      file: TEMPORAL_DOCKERFILE,
      message:
        'ARG ARGOCD_CLI_VERSION=v3.4.5 does not match .mise.toml\'s argocd = "3.6.2" (expected v3.6.2)',
    });
    expect(violations.map((v) => v.message).join("\n")).toContain(
      "GH_CLI_VERSION=2.104.0",
    );
    expect(violations.map((v) => v.message).join("\n")).toContain(
      "TEMPORAL_CLI_VERSION=1.9.0",
    );
    expect(violations.map((v) => v.message).join("\n")).toContain(
      "LYCHEE_VERSION=lychee-v0.24.1",
    );
    expect(violations.map((v) => v.message).join("\n")).toContain(
      "POSTGRESQL_BINARIES_VERSION=18.6.0",
    );
  });

  test("reports missing or mismatched cross-compiler and global.json pins", () => {
    const fixture = validFixture();
    fixture.macosDockerfile = "FROM scratch\n";
    fixture.windowsDockerfile = "ARG RUST_VERSION=1.99.0\n";
    fixture.globalJson = { sdk: { version: "10.0.400" } };

    const violations = validateToolchainVersionSync(fixture);
    expect(violations).toContainEqual({
      file: MACOS_DOCKERFILE,
      message: "no ARG RUST_VERSION found",
    });
    expect(violations).toContainEqual({
      file: WINDOWS_DOCKERFILE,
      message:
        'ARG RUST_VERSION=1.99.0 does not match .mise.toml\'s rust = "1.100.0"',
    });
    expect(violations).toContainEqual({
      file: WINDOWS_DOCKERFILE,
      message: "no ARG DOTNET_SDK_VERSION found",
    });
    expect(violations).toContainEqual({
      file: GLOBAL_JSON_PATH,
      message:
        'sdk.version = "10.0.400" does not match .mise.toml\'s dotnet = "10.0.404"',
    });
  });
});
