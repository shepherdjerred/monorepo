import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { RunOptions, RunResult } from "../lib/run.ts";
import {
  isPlaceholderDockerHubToken,
  parseRenovateDryRunArgs,
  resolveRenovateSecrets,
  runRenovateDryRun,
  sanitizeRenovateConfig,
} from "./renovate-dry-run.ts";

describe("isPlaceholderDockerHubToken", () => {
  test.each([
    "unused",
    "UNUSED",
    "placeholder",
    "dummy",
    "test",
    "fake",
    "<token>",
    "<DOCKERHUB_RENOVATE_TOKEN>",
    "   ",
  ])("rejects placeholder token %j", (value) => {
    expect(isPlaceholderDockerHubToken(value)).toBe(true);
  });

  test("accepts real-looking token values", () => {
    expect(isPlaceholderDockerHubToken("dckr_pat_realCredential123")).toBe(
      false,
    );
  });
});

describe("resolveRenovateSecrets", () => {
  test.each(["unused", "placeholder", "dummy", "test", "fake", "<secret>"])(
    "rejects placeholder DOCKERHUB_RENOVATE_TOKEN=%s in environment or RENOVATE_SECRETS",
    (placeholder) => {
      expect(() =>
        resolveRenovateSecrets({ DOCKERHUB_RENOVATE_TOKEN: placeholder }),
      ).toThrow(/Refusing placeholder DOCKERHUB_RENOVATE_TOKEN/);
      expect(() =>
        resolveRenovateSecrets({
          RENOVATE_SECRETS: JSON.stringify({
            DOCKERHUB_RENOVATE_TOKEN: placeholder,
          }),
        }),
      ).toThrow(/Refusing placeholder DOCKERHUB_RENOVATE_TOKEN/);
    },
  );

  test("rejects malformed RENOVATE_SECRETS without echoing input", () => {
    const secretFragment = "super-secret-value";
    expect(() =>
      resolveRenovateSecrets({ RENOVATE_SECRETS: `bad-${secretFragment}` }),
    ).toThrow(
      "RENOVATE_SECRETS must be a JSON object mapping secret names to strings",
    );
    expect(() =>
      resolveRenovateSecrets({ RENOVATE_SECRETS: '["not-an-object"]' }),
    ).toThrow(
      "RENOVATE_SECRETS must be a JSON object mapping secret names to strings",
    );
  });

  test("returns empty secrets when none are provided and merges real tokens", () => {
    expect(resolveRenovateSecrets({})).toEqual({});
    expect(resolveRenovateSecrets({ DOCKERHUB_RENOVATE_TOKEN: "" })).toEqual(
      {},
    );
    expect(
      resolveRenovateSecrets({
        DOCKERHUB_RENOVATE_TOKEN: "dckr_pat_valid",
        RENOVATE_SECRETS: JSON.stringify({ OTHER_SECRET: "present" }),
      }),
    ).toEqual({
      DOCKERHUB_RENOVATE_TOKEN: "dckr_pat_valid",
      OTHER_SECRET: "present",
    });
  });
});

describe("sanitizeRenovateConfig", () => {
  const sampleConfig = {
    extends: ["config:recommended"],
    hostRules: [
      {
        hostType: "docker",
        matchHost: "docker.io",
        username: "shepherdjerred",
        password: "{{ secrets.DOCKERHUB_RENOVATE_TOKEN }}",
      },
      {
        hostType: "http",
        matchHost: "api.modrinth.com",
        concurrentRequestLimit: 2,
      },
    ],
  };

  test("strips hostRules referencing unprovided secrets and retains non-secret rules", () => {
    expect(sanitizeRenovateConfig(sampleConfig, {})).toEqual({
      extends: ["config:recommended"],
      hostRules: [
        {
          hostType: "http",
          matchHost: "api.modrinth.com",
          concurrentRequestLimit: 2,
        },
      ],
    });
  });

  test("omits hostRules completely when every rule references an unprovided secret", () => {
    const dockerOnly = {
      extends: ["config:recommended"],
      hostRules: [sampleConfig.hostRules[0]],
    };
    const sanitized = sanitizeRenovateConfig(dockerOnly, {});
    expect(sanitized).toEqual({ extends: ["config:recommended"] });
    expect("hostRules" in sanitized).toBe(false);
  });

  test("keeps secret-backed hostRules when the referenced secret is provided", () => {
    expect(
      sanitizeRenovateConfig(sampleConfig, {
        DOCKERHUB_RENOVATE_TOKEN: "dckr_pat_valid",
      }),
    ).toEqual(sampleConfig);
  });
});

describe("parseRenovateDryRunArgs", () => {
  test("defaults mode to extract and reportPath under TMPDIR", () => {
    expect(parseRenovateDryRunArgs([], { TMPDIR: "/var/tmp/custom" })).toEqual({
      mode: "extract",
      reportPath: path.join("/var/tmp/custom", "renovate-extract.json"),
    });
    expect(
      parseRenovateDryRunArgs(["lookup"], { TMPDIR: "/var/tmp/custom" }),
    ).toEqual({
      mode: "lookup",
      reportPath: path.join("/var/tmp/custom", "renovate-lookup.json"),
    });
  });

  test("accepts --report-path in separate or equals form and rejects unknown flags", () => {
    expect(
      parseRenovateDryRunArgs(["lookup", "--report-path", "/tmp/out.json"], {}),
    ).toEqual({
      mode: "lookup",
      reportPath: "/tmp/out.json",
    });
    expect(
      parseRenovateDryRunArgs(
        ["--report-path=/tmp/inline.json", "extract"],
        {},
      ),
    ).toEqual({
      mode: "extract",
      reportPath: "/tmp/inline.json",
    });
    expect(() => parseRenovateDryRunArgs(["unknown"], {})).toThrow(/Usage:/);
    expect(() => parseRenovateDryRunArgs(["--report-path"], {})).toThrow(
      /Usage:/,
    );
    expect(() => parseRenovateDryRunArgs(["--report-path="], {})).toThrow(
      /Usage:/,
    );
  });
});

describe("runRenovateDryRun", () => {
  test("writes a sanitized temp config without docker.io hostRules and cleans it up in finally", async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), "renovate-repo-test-"));
    try {
      await Bun.write(
        path.join(repoDir, "renovate.json"),
        JSON.stringify({
          extends: ["config:recommended"],
          env: { BUN_CONFIG_MAX_HTTP_REQUESTS: "4" },
          hostRules: [
            {
              hostType: "docker",
              matchHost: "docker.io",
              username: "shepherdjerred",
              password: "{{ secrets.DOCKERHUB_RENOVATE_TOKEN }}",
            },
          ],
        }),
      );

      let capturedCmd: string[] = [];
      let capturedTempConfigPath = "";
      let capturedTempConfig: unknown;
      let capturedOptions: RunOptions | undefined;

      const result = await runRenovateDryRun(["lookup"], {
        cwd: repoDir,
        env: { TMPDIR: repoDir },
        runner: async (cmd, opts): Promise<RunResult> => {
          capturedCmd = cmd;
          capturedOptions = opts;
          const configFile = opts?.env?.["RENOVATE_CONFIG_FILE"];
          if (configFile === undefined) {
            throw new Error("missing RENOVATE_CONFIG_FILE");
          }
          capturedTempConfigPath = configFile;
          capturedTempConfig = await Bun.file(configFile).json();
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      });

      expect(result).toEqual({
        mode: "lookup",
        reportPath: path.join(repoDir, "renovate-lookup.json"),
      });
      expect(capturedCmd).toEqual([
        "bunx",
        expect.stringMatching(/^renovate@\d+\.\d+\.\d+$/u),
        "--platform=local",
        "--require-config=ignored",
        "--dry-run=lookup",
        "--report-type=file",
        `--report-path=${path.join(repoDir, "renovate-lookup.json")}`,
      ]);
      expect(capturedOptions?.env?.["RENOVATE_SECRETS"]).toBe("{}");
      expect(
        z.record(z.string(), z.unknown()).parse(capturedTempConfig),
      ).toEqual({
        extends: ["config:recommended"],
        env: { BUN_CONFIG_MAX_HTTP_REQUESTS: "4" },
        allowedEnv: ["BUN_CONFIG_MAX_HTTP_REQUESTS"],
      });
      expect(await Bun.file(capturedTempConfigPath).exists()).toBe(false);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("removes temp config even when renovate exits non-zero", async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), "renovate-fail-test-"));
    try {
      await Bun.write(
        path.join(repoDir, "renovate.json"),
        JSON.stringify({ extends: ["config:recommended"] }),
      );
      let tempPath = "";
      await expect(
        runRenovateDryRun([], {
          cwd: repoDir,
          env: { TMPDIR: repoDir },
          runner: async (_cmd, opts): Promise<RunResult> => {
            tempPath = opts?.env?.["RENOVATE_CONFIG_FILE"] ?? "";
            expect(await Bun.file(tempPath).exists()).toBe(true);
            throw new Error("simulated renovate failure");
          },
        }),
      ).rejects.toThrow("simulated renovate failure");
      expect(tempPath).not.toBe("");
      expect(await Bun.file(tempPath).exists()).toBe(false);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test("presents sanitized tracked config only inside an isolated checkout and restores it on failure", async () => {
    const repoDir = await mkdtemp(
      path.join(tmpdir(), "renovate-isolated-test-"),
    );
    const configPath = path.join(repoDir, "renovate.json");
    const raw = JSON.stringify(
      {
        extends: ["config:recommended"],
        hostRules: [
          {
            matchHost: "docker.io",
            password: "{{ secrets.DOCKERHUB_RENOVATE_TOKEN }}",
          },
        ],
      },
      null,
      2,
    );
    try {
      await Bun.write(configPath, raw);
      await expect(
        runRenovateDryRun(["lookup", "--isolated-checkout"], {
          cwd: repoDir,
          env: {},
          runner: async (_cmd, opts) => {
            const globalConfig = opts?.env?.["RENOVATE_CONFIG_FILE"];
            if (globalConfig === undefined)
              throw new Error("missing global config");
            expect(await Bun.file(globalConfig).json()).toEqual({
              allowedEnv: ["BUN_CONFIG_MAX_HTTP_REQUESTS"],
            });
            expect(await Bun.file(configPath).json()).toEqual({
              extends: ["config:recommended"],
            });
            throw new Error("lookup exited");
          },
        }),
      ).rejects.toThrow("lookup exited");
      expect(await Bun.file(configPath).text()).toBe(raw);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
