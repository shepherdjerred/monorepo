import { describe, expect, test } from "vitest";
import { buildTofuEnvironment, validationInitArguments } from "./tofu-stack.ts";
import { STACK_MANIFEST, type TofuStack } from "./tofu-stack-manifest.ts";
import {
  serializeWorkloadIdentityInventory,
  workloadIdentityInventory,
} from "./export-workload-identity.ts";
import {
  collectOnePasswordTargets,
  loadPlatformDesiredState,
  type PlatformStack,
} from "#scripts/platform-desired-state.ts";

const STATE_SOURCES = [
  "SEAWEEDFS_STATE_ACCESS_KEY_ID",
  "SEAWEEDFS_STATE_SECRET_ACCESS_KEY",
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
  "anthropic",
  "anthropic-federation",
  "argocd",
  "arr",
  "asuswrt",
  "buildkite",
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

describe("Buildkite OpenTofu credential contracts", () => {
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

  test("requires an exact 1Password handoff field for generated keys", async () => {
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
            onepassword_targets: [{ vault_item_id: "birmel-item" }],
          },
        },
      }),
    );
    await expect(loadPlatformDesiredState(stackDir, "google")).rejects.toThrow(
      "vault_field",
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
            onepassword_targets: [
              { vault_item_id: "birmel-item", vault_field: "GEMINI_API_KEY" },
            ],
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

describe("workload identity export", () => {
  const output = JSON.stringify({
    organization_id: "org-123",
    workloads: {
      "birmel-prod": {
        federation_rule_id: "fdrl_abc",
        service_account_id: "svac_abc",
        workspace_id: "wrkspc_abc",
      },
    },
  });

  test("wraps the tofu output as the committed inventory", () => {
    const inventory = workloadIdentityInventory(output);
    expect(inventory.anthropic.workloads["birmel-prod"]?.workspace_id).toBe(
      "wrkspc_abc",
    );
    expect(serializeWorkloadIdentityInventory(inventory)).toBe(
      `${JSON.stringify({ anthropic: JSON.parse(output) }, null, 2)}\n`,
    );
  });

  test("rejects a malformed id at export rather than at synthesis", () => {
    expect(() =>
      workloadIdentityInventory(output.replace("fdrl_abc", "rule-abc")),
    ).toThrow();
  });

  test("rejects federated workloads without an organization", () => {
    expect(() =>
      workloadIdentityInventory(
        output.replace('"organization_id":"org-123"', '"organization_id":null'),
      ),
    ).toThrow("organization_id is required");
  });
});
