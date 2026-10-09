import { describe, expect, test } from "vitest";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  buildTofuEnvironment,
  desiredStateVariableValue,
  validationInitArguments,
} from "./tofu-stack.ts";
import { STACK_MANIFEST, type TofuStack } from "./tofu-stack-manifest.ts";
import {
  collectOnePasswordTargets,
  loadPlatformDesiredState,
  type PlatformStack,
} from "#scripts/platform-desired-state.ts";

const STATE_SOURCES = [
  "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
  "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
];

async function temporaryDirectory(): Promise<string> {
  const process = Bun.spawn(["mktemp", "-d"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`mktemp failed: ${stderr}`);
  }
  return stdout.trim();
}

const STACKS: readonly TofuStack[] = [
  "application-secrets",
  "anthropic",
  "anthropic-federation",
  "argocd",
  "arr",
  "asuswrt",
  "cloudflare",
  "cloudflare-tokens",
  "discord",
  "github",
  "google",
  "openai",
  "posthog",
  "seaweedfs",
  "tailscale",
];

describe("OpenTofu credential contracts", () => {
  test.each(STACKS)("%s requests only its declared credentials", (stack) => {
    const requested: string[] = [];
    buildTofuEnvironment(stack, (environmentName) => {
      requested.push(environmentName);
      return `${environmentName}-value`;
    });
    const definition = STACK_MANIFEST[stack];
    const objectSources =
      definition.secretObject === undefined
        ? []
        : Object.values(definition.secretObject.entries);

    expect(requested.toSorted()).toEqual(
      [
        ...STATE_SOURCES,
        ...definition.credentials.map(({ source }) => source),
        ...objectSources,
      ].toSorted(),
    );
  });

  test("does not inherit an unrelated ambient credential", () => {
    Bun.env["UNRELATED_PLATFORM_SECRET"] = "must-not-cross-boundary";
    try {
      const environment = buildTofuEnvironment(
        "openai",
        (name) => `${name}-value`,
      );
      expect(environment["UNRELATED_PLATFORM_SECRET"]).toBeUndefined();
    } finally {
      delete Bun.env["UNRELATED_PLATFORM_SECRET"];
    }
  });

  test("derives the AsusWRT provider version from the tracked declaration", async () => {
    const provider = await Bun.file(
      new URL("../../src/tofu/asuswrt/providers.tf", import.meta.url),
    ).text();
    expect(provider).toMatch(
      /source\s*=\s*"shepherdjerred\/asuswrt"[\s\S]*?version\s*=\s*"0\.1\.0"/u,
    );
  });

  test("requires the Cloudflare token registry for direct OpenTofu runs", async () => {
    const variables = await Bun.file(
      new URL("../../src/tofu/cloudflare-tokens/variables.tf", import.meta.url),
    ).text();
    expect(variables).not.toContain("default = {}");
  });

  test("keeps validation lockfiles read-only without requiring an AsusWRT lockfile", () => {
    expect(validationInitArguments("openai")).toContain("-lockfile=readonly");
    expect(validationInitArguments("openai")).not.toContain("-upgrade");
    expect(validationInitArguments("asuswrt")).not.toContain(
      "-lockfile=readonly",
    );
  });

  test("provides the legacy PostHog validation passphrase", () => {
    expect(STACK_MANIFEST.posthog.validationPassphraseVariable).toBe(
      "state_passphrase",
    );
  });
});

const PLATFORM_STACKS: readonly PlatformStack[] = [
  "openai",
  "anthropic",
  "anthropic-federation",
  "google",
  "discord",
  "cloudflare-tokens",
];

describe("committed platform desired state", () => {
  test("rejects a nonboolean Cloudflare token management flag", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../platform-desired-state.schema.json",
        platform: "cloudflare-tokens",
        cloudflare_api_tokens: {
          broken: {
            managed: "false",
            supersedes_id: "legacy-token",
            name: "Replacement",
            policies: [
              {
                effect: "allow",
                permission_groups: [{ id: "permission", name: "DNS Read" }],
                resources: { zone: "*" },
              },
            ],
            vault_item_id: "item",
            vault_field: "CLOUDFLARE_API_TOKEN",
          },
        },
      }),
    );
    await expect(
      loadPlatformDesiredState(stackDir, "cloudflare-tokens"),
    ).rejects.toThrow("expected boolean");
  });

  test.each(PLATFORM_STACKS)("%s matches its schema", async (platform) => {
    const stackDir = new URL(`../../src/tofu/${platform}/`, import.meta.url)
      .pathname;
    await expect(
      loadPlatformDesiredState(stackDir, platform),
    ).resolves.toBeDefined();
  });

  test("rejects undeclared top-level variables", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../../platform-desired-state.schema.json",
        platform: "cloudflare-tokens",
        cloudflare_api_tokens: {},
        unexpected: {},
      }),
    );
    await expect(
      loadPlatformDesiredState(stackDir, "cloudflare-tokens"),
    ).rejects.toThrow("Unrecognized key");
  });

  test("rejects a desired-state file for the wrong platform", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../../platform-desired-state.schema.json",
        platform: "cloudflare-tokens",
        cloudflare_api_tokens: {},
      }),
    );
    await expect(loadPlatformDesiredState(stackDir, "openai")).rejects.toThrow(
      "Desired state for openai declares platform cloudflare-tokens",
    );
  });

  test("rejects malformed Discord application metadata", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../../platform-desired-state.schema.json",
        platform: "discord",
        discord_bots: {
          broken: {
            application_name: "Broken",
            expected_application_id: "not-a-snowflake",
            vault_item_id: "item",
          },
        },
      }),
    );
    await expect(loadPlatformDesiredState(stackDir, "discord")).rejects.toThrow(
      "expected_application_id must be numeric",
    );
  });

  test("requires a valid 1Password item title for each minted Gemini key", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../../platform-desired-state.schema.json",
        platform: "google",
        google_billing_account_id: null,
        google_quota_project_id: null,
        google_workloads: {
          birmel: {
            project_id: "sjerred-llm-birmel",
            display_name: "LLM birmel",
            monthly_budget_usd: 10,
            ai_studio_spend_cap_usd: 10,
            gemini_key_revision: 1,
            gemini_quota_limits: {
              "gemini-3-pro-image": {
                requests_per_day: 50,
                requests_per_minute: 5,
              },
            },
            // CDK8s references the item by this title, so it must be a
            // title the cluster's item path can carry.
            onepassword_item_title: "Birmel Gemini Key",
          },
        },
      }),
    );
    await expect(loadPlatformDesiredState(stackDir, "google")).rejects.toThrow(
      "onepassword_item_title",
    );
  });

  test("refuses a Gemini spend cap above its budget", async () => {
    // The budget is the early warning and the AI Studio cap is the stop. A cap
    // above the budget means the warning arrives after the stop should have.
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../../platform-desired-state.schema.json",
        platform: "google",
        google_billing_account_id: null,
        google_quota_project_id: null,
        google_workloads: {
          birmel: {
            project_id: "sjerred-llm-birmel",
            display_name: "LLM birmel",
            monthly_budget_usd: 10,
            ai_studio_spend_cap_usd: 50,
            gemini_key_revision: 1,
            gemini_quota_limits: {
              "gemini-3-pro-image": {
                requests_per_day: 50,
                requests_per_minute: 5,
              },
            },
            onepassword_item_title: "llm-gemini-birmel",
          },
        },
      }),
    );
    await expect(loadPlatformDesiredState(stackDir, "google")).rejects.toThrow(
      "must not exceed monthly_budget_usd",
    );
  });

  test("keeps Anthropic token lifetimes inside the projected token's rotation", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../../platform-desired-state.schema.json",
        platform: "anthropic-federation",
        anthropic_federation_workspaces: { prod: { name: "prod" } },
        anthropic_federation_issuer: {
          name: "cluster",
          issuer_url: "https://cluster.example",
          jwks_keys_json: "[]",
          max_jwt_lifetime_seconds: 3600,
        },
        anthropic_federation_workloads: {
          birmel: {
            workspace_key: "prod",
            namespace: "birmel",
            token_lifetime_seconds: 3600,
          },
        },
      }),
    );
    await expect(
      loadPlatformDesiredState(stackDir, "anthropic-federation"),
    ).rejects.toThrow();
  });
});

describe("platform credential handoffs", () => {
  test("collects handoffs nested in resource objects", () => {
    expect(
      collectOnePasswordTargets({
        direct: {
          vault_item_id: "direct-item",
          vault_field: "direct-field",
          name: "resource metadata",
        },
        nested: [
          {
            vault_item_id: "nested-item",
            vault_field: "nested-field",
          },
        ],
      }),
    ).toEqual([
      {
        vault_item_id: "direct-item",
        vault_field: "direct-field",
      },
      {
        vault_item_id: "nested-item",
        vault_field: "nested-field",
      },
    ]);
  });

  test("archived Anthropic keys retain metadata without a vault handoff", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../platform-desired-state.schema.json",
        platform: "anthropic",
        anthropic_workspaces: {},
        anthropic_api_keys: {
          retired: {
            api_key_id: "apikey-retired",
            name: "Retired integration",
            status: "archived",
          },
        },
        anthropic_workspace_members: {},
      }),
    );
    const state = await loadPlatformDesiredState(stackDir, "anthropic");
    expect(collectOnePasswordTargets(state)).toEqual([]);
  });

  test.each(["active", "inactive"])(
    "%s Anthropic keys still require a vault handoff",
    async (status) => {
      const stackDir = await temporaryDirectory();
      await Bun.write(
        `${stackDir}/desired-state.json`,
        JSON.stringify({
          $schema: "../platform-desired-state.schema.json",
          platform: "anthropic",
          anthropic_workspaces: {},
          anthropic_api_keys: {
            missing: { api_key_id: "apikey-missing", name: "Missing", status },
          },
          anthropic_workspace_members: {},
        }),
      );
      await expect(
        loadPlatformDesiredState(stackDir, "anthropic"),
      ).rejects.toThrow();
    },
  );

  test("archived Anthropic keys cannot retain a vault handoff", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../platform-desired-state.schema.json",
        platform: "anthropic",
        anthropic_workspaces: {},
        anthropic_api_keys: {
          retired: {
            api_key_id: "apikey-retired",
            name: "Retired integration",
            status: "archived",
            vault_item_id: "obsolete-item",
            vault_field: "obsolete-key",
          },
        },
        anthropic_workspace_members: {},
      }),
    );
    await expect(
      loadPlatformDesiredState(stackDir, "anthropic"),
    ).rejects.toThrow();
  });

  test("collects Discord item-only handoffs", () => {
    expect(
      collectOnePasswordTargets({
        discord_bots: {
          birmel: {
            application_name: "Birmel",
            expected_application_id: "123",
            vault_item_id: "birmel-item",
          },
        },
      }),
    ).toEqual([{ vault_item_id: "birmel-item" }]);
  });
});

describe("desired-state variables", () => {
  test("passes strings literally and encodes every other type", () => {
    // A string variable reads its environment value verbatim, so encoding it
    // would deliver the quotes too and fail the variable's own validation.
    expect(desiredStateVariableValue("012345-6789AB-CDEF01")).toBe(
      "012345-6789AB-CDEF01",
    );
    expect(desiredStateVariableValue(null)).toBe("null");
    expect(desiredStateVariableValue({ birmel: { budget: 10 } })).toBe(
      '{"birmel":{"budget":10}}',
    );
  });
});

const Observation = z.object({
  action: z.string(),
  data: z.string(),
  mode: z.number(),
  cache: z.string(),
  backendPresent: z.boolean(),
});

test.each([
  { initExit: 0, planExit: 0, success: true },
  { initExit: 0, planExit: 2, success: true },
  { initExit: 1, planExit: 0, success: false },
  { initExit: 0, planExit: 1, success: false },
])(
  "plan data is private and removed for $initExit/$planExit",
  async ({ initExit, planExit, success }) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "tofu-plan-test-"));
    const log = path.join(fixture, "observations.jsonl");
    const executable = path.join(fixture, "tofu");
    try {
      await Bun.write(
        executable,
        String.raw`#!${process.execPath}
import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
const action = process.argv[3];
const data = process.env.TF_DATA_DIR;
if (!data) throw new Error("No private data directory");
const backend = data + "/backend-fixture";
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ action, data,
  mode: statSync(data).mode & 0o777, cache: process.env.TF_PLUGIN_CACHE_DIR,
  backendPresent: existsSync(backend) }) + "\n");
if (action === "init") writeFileSync(backend, "synthetic backend fixture");
process.exit(action === "init" ? ${String(initExit)} : ${String(planExit)});
`,
      );
      await chmod(executable, 0o700);
      const child = Bun.spawn(
        [
          process.execPath,
          new URL("tofu-stack.ts", import.meta.url).pathname,
          "github",
          "plan",
        ],
        {
          env: {
            PATH: `${fixture}:${Bun.env["PATH"] ?? ""}`,
            TMPDIR: fixture,
            TF_PLUGIN_CACHE_DIR: path.join(fixture, "provider-cache"),
            TF_DATA_DIR: path.join(fixture, "must-not-inherit"),
            SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID: "fixture-state-id",
            SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY: "fixture-state-key",
            TOFU_GITHUB_TOKEN: "fixture-github-token",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode === 0, stdout + stderr).toBe(success);
      const recorded = await Bun.file(log).text();
      const observations = recorded
        .trim()
        .split("\n")
        .map((line) => Observation.parse(JSON.parse(line)));
      expect(observations.map((item) => item.action)).toEqual(
        initExit === 0 ? ["init", "plan"] : ["init"],
      );
      const first = observations[0];
      if (first === undefined) throw new Error("Missing init observation");
      expect(first.data).toContain(path.join(fixture, "tofu-plan."));
      expect(first.mode).toBe(0o700);
      expect(first.backendPresent).toBe(false);
      for (const item of observations) {
        expect(item.data).toBe(first.data);
        expect(item.cache).toBe(path.join(fixture, "provider-cache"));
      }
      if (initExit === 0) expect(observations[1]?.backendPresent).toBe(true);
      await expect(stat(first.data)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  },
);
