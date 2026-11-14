import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";

const ConfigurationSchema = z.looseObject({
  data: z.record(z.string(), z.record(z.string(), z.unknown())),
  locals: z.record(z.string(), z.string()),
  variable: z.record(z.string(), z.unknown()),
  resource: z.record(z.string(), z.record(z.string(), z.unknown())),
  output: z.record(z.string(), z.unknown()),
  import: z.array(z.unknown()).optional(),
  moved: z.array(z.unknown()).optional(),
  removed: z.array(z.unknown()).optional(),
  terraform: z.looseObject({
    required_version: z.string(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
    encryption: z.unknown(),
  }),
});

async function google() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(JSON.parse(synthesized.get("google") ?? ""));
}

const WORKLOADS = "${var.google_workloads}";

describe("google", () => {
  test("keeps the addresses of its state", async () => {
    const { resource, data, variable, output } = await google();
    expect(
      Object.entries(resource).flatMap(([type, byName]) =>
        Object.keys(byName).map((name) => `${type}.${name}`),
      ),
    ).toEqual([
      "google_apikeys_key.gemini",
      "google_billing_budget.workload",
      "google_cloud_quotas_quota_preference.gemini",
      "google_project.workload",
      "google_project_service.workload",
      "google_service_account.gemini_key",
      "onepassword_item.gemini",
    ]);
    expect(data).toEqual({
      google_billing_account: {
        llm: { billing_account: "${var.google_billing_account_id}" },
      },
    });
    expect(Object.keys(variable).toSorted()).toEqual([
      "google_billing_account_id",
      "google_quota_project_id",
      "google_workloads",
      "tofu_state_encryption_passphrase",
    ]);
    expect(Object.keys(output)).toEqual(["google_gemini_spend_caps"]);
  });

  test("declares no import, moved or removed block", async () => {
    const configuration = await google();
    expect(configuration.import).toBeUndefined();
    expect(configuration.moved).toBeUndefined();
    expect(configuration.removed).toBeUndefined();
  });

  test("keys each resource by the map its instances were created from", async () => {
    const { resource, locals } = await google();
    for (const address of [
      ["google_project", "workload"],
      ["google_service_account", "gemini_key"],
      ["google_billing_budget", "workload"],
      ["google_apikeys_key", "gemini"],
      ["onepassword_item", "gemini"],
    ] as const) {
      expect(
        resource[address[0]]?.[address[1]],
        address.join("."),
      ).toMatchObject({ for_each: WORKLOADS });
    }
    expect(resource["google_project_service"]?.["workload"]).toMatchObject({
      for_each: "${local.workload_services}",
      project: "${google_project.workload[each.value.workload].project_id}",
      service: "${each.value.service}",
    });
    expect(
      resource["google_cloud_quotas_quota_preference"]?.["gemini"],
    ).toMatchObject({
      for_each: "${local.gemini_quota_limits}",
      quota_id: "${each.value.quota_id}",
      dimensions: { model: "${each.value.model}" },
    });
    // Composite instance keys: `<workload>/<service>` and
    // `<workload>/<model>/<day|minute>`.
    expect(locals["workload_services"]).toContain(
      '"${pair[0]}/${pair[1]}" => { workload = pair[0], service = pair[1] }',
    );
    expect(locals["gemini_quota_limits"]).toContain(
      '"${workload}/${model}/day" = {',
    );
    expect(locals["gemini_quota_limits"]).toContain(
      '"${workload}/${model}/minute" = {',
    );
    expect(locals["project_services"]).toBe(
      '${toset(["apikeys.googleapis.com","cloudquotas.googleapis.com","generativelanguage.googleapis.com","monitoring.googleapis.com"])}',
    );
  });

  test("keeps project deletion protection, key rotation order and API ordering", async () => {
    const { resource } = await google();
    expect(resource["google_project"]?.["workload"]).toMatchObject({
      deletion_policy: "PREVENT",
    });
    expect(resource["google_apikeys_key"]?.["gemini"]).toMatchObject({
      name: "gemini-${each.key}-r${each.value.gemini_key_revision}",
      lifecycle: { create_before_destroy: true },
      depends_on: ["google_project_service.workload"],
      restrictions: {
        api_targets: [{ service: "generativelanguage.googleapis.com" }],
      },
    });
    for (const address of [
      ["google_service_account", "gemini_key"],
      ["google_cloud_quotas_quota_preference", "gemini"],
    ] as const) {
      expect(
        resource[address[0]]?.[address[1]],
        address.join("."),
      ).toMatchObject({ depends_on: ["google_project_service.workload"] });
    }
    expect(resource["google_billing_budget"]?.["workload"]).toMatchObject({
      threshold_rules: [
        { threshold_percent: 0.5 },
        { threshold_percent: 0.9 },
        { threshold_percent: 1 },
        { threshold_percent: 1, spend_basis: "FORECASTED_SPEND" },
      ],
    });
  });

  test("hands each key off as a concealed field of the workload's item", async () => {
    const { resource } = await google();
    expect(resource["onepassword_item"]?.["gemini"]).toEqual({
      for_each: WORKLOADS,
      vault: "v64ocnykdqju4ui6j6pua56xw4",
      title: "${each.value.onepassword_item_title}",
      category: "secure_note",
      section: [
        {
          label: "credentials",
          field: [
            {
              label: "GEMINI_API_KEY",
              type: "CONCEALED",
              value: "${google_apikeys_key.gemini[each.key].key_string}",
            },
          ],
        },
      ],
    });
  });

  test("keeps the provider constraints its lock file records, and encrypts state", async () => {
    const { terraform } = await google();
    expect(terraform.required_version).toBe(">= 1.9.0");
    expect(terraform.required_providers).toEqual({
      google: { source: "hashicorp/google", version: "~> 8.4" },
      onepassword: { source: "1password/onepassword", version: "~> 3.0" },
    });
    expect(terraform.encryption).toMatchObject({
      key_provider: { pbkdf2: { state: {} } },
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
  });
});
