import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown(),
    required_version: z.string(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  provider: z.record(z.string(), z.unknown()),
  variable: z.record(z.string(), z.unknown()),
  resource: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), z.unknown())),
  ),
  import: z.array(z.record(z.string(), z.unknown())),
  moved: z.array(z.object({ from: z.string(), to: z.string() })),
  removed: z.array(z.record(z.string(), z.unknown())),
  output: z.record(z.string(), z.unknown()),
});

async function openai() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(JSON.parse(synthesized.get("openai") ?? ""));
}

/** Each `for_each` instance the stack forgets, and the address it is forgotten at. */
const RETIRED = [
  ['openai_project.managed["openrouter"]', "openai_project.retired_openrouter"],
  ['openai_project.managed["scout-beta"]', "openai_project.retired_scout_beta"],
  [
    'openai_project_spend_alert.managed["scout-beta-monthly"]',
    "openai_project_spend_alert.retired_scout_beta_monthly",
  ],
  [
    'openai_project_spend_limit.managed["scout-beta-monthly"]',
    "openai_project_spend_limit.retired_scout_beta_monthly",
  ],
  [
    'openai_project.managed["scout-active-2026-09"]',
    "openai_project.retired_scout_active_2026_09",
  ],
  [
    'openai_project_spend_alert.managed["scout-monthly"]',
    "openai_project_spend_alert.retired_scout_monthly",
  ],
  [
    'openai_project_spend_limit.managed["scout-active-monthly-2026-09"]',
    "openai_project_spend_limit.retired_scout_active_monthly_2026_09",
  ],
  [
    'openai_project.managed["scout-prod-active-2026-09"]',
    "openai_project.retired_scout_prod_active_2026_09",
  ],
  [
    'openai_project_spend_alert.managed["scout-prod-monthly"]',
    "openai_project_spend_alert.retired_scout_prod_monthly",
  ],
  [
    'openai_project_spend_limit.managed["scout-prod-monthly"]',
    "openai_project_spend_limit.retired_scout_prod_monthly",
  ],
] as const;

describe("openai", () => {
  test("keeps the addresses and instance keys of its state", async () => {
    const { resource, variable, output } = await openai();
    // Every resource iterates the variable of its HCL `for_each`, so instance
    // keys stay the desired-state keys.
    expect(
      Object.entries(resource).flatMap(([type, byName]) =>
        Object.entries(byName).map(([name, body]) => [
          `${type}.${name}`,
          body["for_each"],
        ]),
      ),
    ).toEqual([
      ["openai_certificate.managed", "${var.openai_certificates}"],
      ["openai_group.managed", "${var.openai_groups}"],
      ["openai_group_role.managed", "${var.openai_group_roles}"],
      ["openai_group_user.managed", "${var.openai_group_users}"],
      [
        "openai_organization_spend_alert.managed",
        "${var.openai_organization_spend_alerts}",
      ],
      [
        "openai_organization_spend_limit.managed",
        "${var.openai_organization_spend_limits}",
      ],
      ["openai_organization_user.managed", "${var.openai_organization_users}"],
      ["openai_project.managed", "${var.openai_projects}"],
      [
        "openai_project_data_retention.managed",
        "${var.openai_project_data_retention}",
      ],
      ["openai_project_group.managed", "${var.openai_project_groups}"],
      [
        "openai_project_group_role.managed",
        "${var.openai_project_group_roles}",
      ],
      [
        "openai_project_hosted_tool_permissions.managed",
        "${var.openai_project_hosted_tool_permissions}",
      ],
      [
        "openai_project_model_permissions.managed",
        "${var.openai_project_model_permissions}",
      ],
      [
        "openai_project_rate_limit.managed",
        "${var.openai_project_rate_limits}",
      ],
      [
        "openai_project_service_account.service_accounts",
        "${var.openai_service_accounts}",
      ],
      [
        "openai_project_spend_alert.managed",
        "${var.openai_project_spend_alerts}",
      ],
      [
        "openai_project_spend_limit.managed",
        "${var.openai_project_spend_limits}",
      ],
      ["openai_project_user_role.managed", "${var.openai_project_users}"],
      ["openai_role.managed", "${var.openai_roles}"],
      ["openai_user_role.managed", "${var.openai_user_roles}"],
    ]);
    expect(Object.keys(variable)).toHaveLength(22);
    expect(variable["openai_certificate_values"]).toMatchObject({
      sensitive: true,
      type: "map(string)",
    });
    expect(Object.keys(output).toSorted()).toEqual([
      "openai_project_ids",
      "openai_service_account_handoffs",
    ]);
    expect(output["openai_service_account_handoffs"]).toMatchObject({
      sensitive: true,
    });
  });

  test("protects imported users and groups, and orders spend limits after alerts", async () => {
    const { resource } = await openai();
    expect(resource["openai_organization_user"]?.["managed"]).toMatchObject({
      lifecycle: { prevent_destroy: true },
    });
    expect(resource["openai_group"]?.["managed"]).toMatchObject({
      lifecycle: { prevent_destroy: true },
    });
    expect(
      resource["openai_project_spend_limit"]?.["managed"]?.["depends_on"],
    ).toEqual(["openai_project_spend_alert.managed"]);
  });

  test("declares both providers under their local names and selects the companion only for service accounts", async () => {
    const { terraform, provider, resource } = await openai();
    expect(terraform.required_version).toBe(">= 1.9.0");
    expect(terraform.required_providers).toEqual({
      openai: { source: "openai/openai", version: "~> 1.1" },
      openaikeys: { source: "jianyuan/openai", version: "~> 0.7" },
    });
    expect(provider).toEqual({ openai: [{}], openaikeys: [{}] });
    expect(
      Object.entries(resource).flatMap(([type, byName]) =>
        Object.values(byName).flatMap((body) =>
          "provider" in body ? [[type, body["provider"]]] : [],
        ),
      ),
    ).toEqual([["openai_project_service_account", "openaikeys"]]);
  });

  test("imports projects with an id and every declared group, certificate and user", async () => {
    const { import: imports } = await openai();
    expect(imports).toEqual([
      {
        for_each:
          "${{ for name, project in var.openai_projects : name => project if try(project.project_id, null) != null }}",
        to: "openai_project.managed[each.key]",
        id: "${each.value.project_id}",
      },
      {
        for_each: "${var.openai_groups}",
        to: "openai_group.managed[each.key]",
        id: "${each.value.group_id}",
      },
      {
        for_each: "${var.openai_certificates}",
        to: "openai_certificate.managed[each.key]",
        id: "${each.value.certificate_id}",
      },
      {
        for_each: "${var.openai_organization_users}",
        to: "openai_organization_user.managed[each.key]",
        id: "${each.value.user_id}",
      },
    ]);
  });

  test("keeps the Woodpecker renames and forgets the archived projects instead of destroying them", async () => {
    const { moved, removed } = await openai();
    expect(moved).toEqual([
      {
        from: 'openai_project.managed["buildkite"]',
        to: 'openai_project.managed["woodpecker"]',
      },
      {
        from: 'openai_project_spend_alert.managed["buildkite-monthly"]',
        to: 'openai_project_spend_alert.managed["woodpecker-monthly"]',
      },
      {
        from: 'openai_project_spend_limit.managed["buildkite-monthly"]',
        to: 'openai_project_spend_limit.managed["woodpecker-monthly"]',
      },
      {
        from: 'openai_project_model_permissions.managed["buildkite"]',
        to: 'openai_project_model_permissions.managed["woodpecker"]',
      },
      ...RETIRED.map(([from, to]) => ({ from, to })),
    ]);
    expect(removed).toEqual(
      RETIRED.map(([, from]) => ({ from, lifecycle: { destroy: false } })),
    );
  });

  test("encrypts state and plans with the key provider its state records", async () => {
    const { terraform } = await openai();
    expect(terraform.encryption).toMatchObject({
      key_provider: { pbkdf2: { state: {} } },
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
  });
});
