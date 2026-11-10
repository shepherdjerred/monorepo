import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  data: z.record(z.string(), z.record(z.string(), z.unknown())),
  variable: z.record(z.string(), z.unknown()),
  resource: z.record(z.string(), z.record(z.string(), z.unknown())),
});

async function federation() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("anthropic-federation") ?? ""),
  );
}

const WORKLOADS = "${var.anthropic_federation_workloads}";

describe("anthropic-federation", () => {
  test("keeps the addresses of its state", async () => {
    const { resource, data, variable } = await federation();
    expect(
      Object.entries(resource).flatMap(([type, byName]) =>
        Object.keys(byName).map((name) => `${type}.${name}`),
      ),
    ).toEqual([
      "anthropic_federation_issuer.cluster",
      "anthropic_federation_rule.workload",
      "anthropic_service_account.workload",
      "anthropic_service_account_workspace.workload",
      "anthropic_workspace.managed",
      "onepassword_item.workload_identity",
    ]);
    expect(Object.keys(data)).toEqual(["anthropic_organization"]);
    expect(Object.keys(data["anthropic_organization"] ?? {})).toEqual([
      "current",
    ]);
    expect(Object.keys(variable).toSorted()).toEqual([
      "anthropic_federation_issuer",
      "anthropic_federation_workloads",
      "anthropic_federation_workspaces",
      "tofu_state_encryption_passphrase",
    ]);
  });

  test("keys every workload resource by the same workload map", async () => {
    const { resource } = await federation();
    for (const address of [
      ["anthropic_service_account", "workload"],
      ["anthropic_service_account_workspace", "workload"],
      ["anthropic_federation_rule", "workload"],
      ["onepassword_item", "workload_identity"],
    ] as const) {
      expect(
        resource[address[0]]?.[address[1]],
        address.join("."),
      ).toMatchObject({ for_each: WORKLOADS });
    }
    expect(resource["anthropic_federation_rule"]?.["workload"]).toMatchObject({
      depends_on: ["anthropic_service_account_workspace.workload"],
      oauth_scope: "workspace:inference",
    });
  });

  test("hands the identifiers off as non-secret STRING fields", async () => {
    const { resource } = await federation();
    expect(resource["onepassword_item"]?.["workload_identity"]).toMatchObject({
      vault: "v64ocnykdqju4ui6j6pua56xw4",
      category: "secure_note",
      section: [
        {
          label: "federation",
          field: [
            { label: "ANTHROPIC_ORGANIZATION_ID", type: "STRING" },
            { label: "ANTHROPIC_FEDERATION_RULE_ID", type: "STRING" },
            { label: "ANTHROPIC_SERVICE_ACCOUNT_ID", type: "STRING" },
            { label: "ANTHROPIC_WORKSPACE_ID", type: "STRING" },
          ],
        },
      ],
    });
  });

  test("keeps the provider constraints its lock file records, and encrypts state", async () => {
    const { terraform } = await federation();
    expect(terraform.required_providers).toEqual({
      anthropic: {
        source: "registry.terraform.io/ippontech/anthropic",
        version: "1.60.0",
      },
      onepassword: { source: "1password/onepassword", version: "~> 3.0" },
    });
    expect(terraform.encryption).toMatchObject({
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
  });
});
