import { describe, expect, test } from "vitest";
import { z } from "zod";
import { TerraformSchema, useSynthesizedApp } from "#src/testing.ts";

const ConfigurationSchema = z.looseObject({
  terraform: TerraformSchema,
  variable: z.record(z.string(), z.unknown()),
  resource: z.record(z.string(), z.record(z.string(), z.unknown())),
  import: z.array(z.record(z.string(), z.unknown())),
  moved: z.array(z.record(z.string(), z.unknown())),
  removed: z.array(z.record(z.string(), z.unknown())),
  output: z.record(z.string(), z.unknown()),
});

const readStack = useSynthesizedApp();
const anthropic = () => readStack("anthropic", ConfigurationSchema);

describe("anthropic", () => {
  test("keeps the addresses of its state", () => {
    const { resource, variable, output } = anthropic();
    expect(
      Object.entries(resource).flatMap(([type, byName]) =>
        Object.keys(byName).map((name) => `${type}.${name}`),
      ),
    ).toEqual([
      "anthropic_api_key.managed",
      "anthropic_workspace.managed",
      "anthropic_workspace_member.managed",
    ]);
    expect(Object.keys(variable).toSorted()).toEqual([
      "anthropic_api_keys",
      "anthropic_workspace_members",
      "anthropic_workspaces",
      "tofu_state_encryption_passphrase",
    ]);
    expect(Object.keys(output).toSorted()).toEqual([
      "anthropic_api_key_rotation_units",
      "anthropic_workspace_ids",
    ]);
    expect(resource["anthropic_api_key"]?.["managed"]).toMatchObject({
      for_each: "${var.anthropic_api_keys}",
      lifecycle: { prevent_destroy: true },
    });
  });

  test("imports every declared key and every workspace with an id", () => {
    const { import: imports } = anthropic();
    expect(imports).toEqual([
      {
        for_each:
          "${{ for name, workspace in var.anthropic_workspaces : name => workspace if try(workspace.workspace_id, null) != null }}",
        to: "anthropic_workspace.managed[each.key]",
        id: "${each.value.workspace_id}",
      },
      {
        for_each: "${var.anthropic_api_keys}",
        to: "anthropic_api_key.managed[each.key]",
        id: "${each.value.api_key_id}",
      },
    ]);
  });

  test("forgets the archived OpenRouter key instead of destroying it", () => {
    const { moved, removed } = anthropic();
    expect(moved).toEqual([
      {
        from: 'anthropic_api_key.managed["openrouter"]',
        to: "anthropic_api_key.retired_openrouter",
      },
    ]);
    expect(removed).toEqual([
      {
        from: "anthropic_api_key.retired_openrouter",
        lifecycle: { destroy: false },
      },
    ]);
  });

  test("keeps the provider address and constraint its lock file records, and encrypts state", () => {
    const { terraform } = anthropic();
    expect(terraform.required_providers).toEqual({
      anthropic: {
        source: "registry.terraform.io/ippontech/anthropic",
        version: "1.96.0",
      },
    });
    expect(terraform.encryption).toMatchObject({
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
  });
});
