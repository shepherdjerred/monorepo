import { describe, expect, test } from "vitest";
import {
  addValidationOnlySecrets,
  buildTofuEnvironment,
  validationInitArguments,
} from "./tofu-stack.ts";
import { STACK_MANIFEST, type TofuStack } from "./tofu-stack-manifest.ts";
import {
  collectOnePasswordTargets,
  loadPlatformDesiredState,
  type PlatformStack,
} from "./platform-desired-state.ts";

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
  "argocd",
  "arr",
  "asuswrt",
  "buildkite",
  "cloudflare",
  "cloudflare-tokens",
  "discord",
  "github",
  "openai",
  "openrouter",
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
      new URL("../src/tofu/asuswrt/providers.tf", import.meta.url),
    ).text();
    expect(provider).toMatch(
      /source\s*=\s*"shepherdjerred\/asuswrt"[\s\S]*?version\s*=\s*"0\.1\.0"/u,
    );
  });

  test("requires the Cloudflare token registry for direct OpenTofu runs", async () => {
    const variables = await Bun.file(
      new URL("../src/tofu/cloudflare-tokens/variables.tf", import.meta.url),
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

  test("synthesizes one dummy value per OpenRouter BYOK credential", () => {
    const environment: Record<string, string> = {};
    addValidationOnlySecrets(
      "openrouter",
      {
        openrouter_byok_credentials: {
          anthropic: {},
          openai: {},
        },
      },
      environment,
    );
    expect(
      JSON.parse(environment["TF_VAR_openrouter_byok_keys"] ?? ""),
    ).toEqual({
      anthropic: "ci-validation-only-provider-key",
      openai: "ci-validation-only-provider-key",
    });
  });
});

const PLATFORM_STACKS: readonly PlatformStack[] = [
  "openai",
  "anthropic",
  "discord",
  "openrouter",
  "cloudflare-tokens",
];

describe("committed platform desired state", () => {
  test.each(PLATFORM_STACKS)("%s matches its schema", async (platform) => {
    const stackDir = new URL(`../src/tofu/${platform}/`, import.meta.url)
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
        $schema: "../platform-desired-state.schema.json",
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
        $schema: "../platform-desired-state.schema.json",
        platform: "cloudflare-tokens",
        cloudflare_api_tokens: {},
      }),
    );
    await expect(
      loadPlatformDesiredState(stackDir, "openrouter"),
    ).rejects.toThrow(
      "Desired state for openrouter declares platform cloudflare-tokens",
    );
  });

  test("rejects malformed Discord application metadata", async () => {
    const stackDir = await temporaryDirectory();
    await Bun.write(
      `${stackDir}/desired-state.json`,
      JSON.stringify({
        $schema: "../platform-desired-state.schema.json",
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
        $schema: "../platform-desired-state.schema.json",
        platform: "openrouter",
        openrouter_workspaces: {},
        openrouter_guardrails: {},
        openrouter_api_keys: {
          birmel: {
            name: "birmel",
            onepassword_targets: [
              {
                vault_item_id: "birmel-item",
              },
            ],
          },
        },
        openrouter_byok_credentials: {},
      }),
    );
    await expect(
      loadPlatformDesiredState(stackDir, "openrouter"),
    ).rejects.toThrow("vault_field");
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
});
