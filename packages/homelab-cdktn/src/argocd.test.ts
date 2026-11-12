import { expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";
import { HOMELAB_VAULT_ID } from "#src/onepassword.ts";

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
    required_version: z.string(),
  }),
  provider: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  variable: z.record(z.string(), z.looseObject({ sensitive: z.boolean() })),
  resource: z.record(z.string(), z.record(z.string(), z.unknown())),
  output: z.record(z.string(), z.object({ value: z.string() }).loose()),
});

async function argocd() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(JSON.parse(synthesized.get("argocd") ?? ""));
}

/** The ArgoCD token, 1Password item and output of each account, by address. */
const HANDOFFS = [
  {
    token: "delivery",
    item: "argocd_delivery_token",
    title: "delivery-argocd-token",
    field: "ARGOCD_TOKEN",
    output: "delivery_onepassword_item_id",
  },
  {
    token: "delivery_observer",
    item: "argocd_delivery_observer_token",
    title: "delivery-argocd-observer-token",
    field: "ARGOCD_RECOVERY_TOKEN",
    output: "delivery_observer_onepassword_item_id",
  },
  {
    token: "delivery_platform",
    item: "argocd_delivery_platform_token",
    title: "delivery-argocd-platform-token",
    field: "ARGOCD_TOKEN",
    output: "delivery_platform_onepassword_item_id",
  },
  {
    token: "operator_run",
    item: "argocd_operator_run_token",
    title: "delivery-argocd-operator-run-token",
    field: "ARGOCD_TOKEN",
    output: "operator_run_onepassword_item_id",
  },
  {
    token: "workstation",
    item: "argocd_workstation_token",
    title: "argocd-workstation-token",
    field: "ARGOCD_AUTH_TOKEN",
    output: "workstation_onepassword_item_id",
  },
  {
    token: "homelab_audit",
    item: "argocd_homelab_audit_token",
    title: "argocd-homelab-audit-token",
    field: "ARGOCD_AUTH_TOKEN",
    output: "homelab_audit_onepassword_item_id",
  },
] as const;

test("argocd keeps the token and 1Password item addresses of its state", async () => {
  const { resource, output } = await argocd();
  expect(Object.keys(resource).toSorted()).toEqual([
    "argocd_account_token",
    "onepassword_item",
  ]);
  expect(
    Object.keys(resource["argocd_account_token"] ?? {}).toSorted(),
  ).toEqual(HANDOFFS.map(({ token }) => token).toSorted());
  expect(Object.keys(resource["onepassword_item"] ?? {}).toSorted()).toEqual(
    HANDOFFS.map(({ item }) => item).toSorted(),
  );
  expect(Object.keys(output).toSorted()).toEqual(
    HANDOFFS.map(({ output: name }) => name).toSorted(),
  );
});

test("each account's token is written to its own concealed 1Password field", async () => {
  const { resource, output } = await argocd();
  for (const { token, item, title, field, output: name } of HANDOFFS) {
    expect(resource["argocd_account_token"]?.[token]).toEqual({
      account: token.replaceAll("_", "-"),
    });
    expect(resource["onepassword_item"]?.[item]).toEqual({
      vault: HOMELAB_VAULT_ID,
      title,
      section: [
        {
          label: "tokens",
          field: [
            {
              label: field,
              type: "CONCEALED",
              value: `\${argocd_account_token.${token}.jwt}`,
            },
          ],
        },
      ],
    });
    expect(output[name]?.value).toBe(`\${onepassword_item.${item}.uuid}`);
  }
});

test("argocd authenticates as the tofu-argocd account and keeps its lock constraints", async () => {
  const { terraform, provider, variable, ...rest } = await argocd();
  expect(provider["argocd"]).toEqual([
    {
      server_addr: "argocd.tailnet-1a49.ts.net:443",
      auth_token: "${var.argocd_auth_token}",
    },
  ]);
  expect(provider["onepassword"]).toEqual([{}]);
  expect(variable["argocd_auth_token"]?.sensitive).toBe(true);
  // The lock file records these constraints; a different one rewrites it.
  expect(terraform.required_providers).toEqual({
    argocd: { source: "argoproj-labs/argocd", version: "~> 7.0" },
    onepassword: { source: "1password/onepassword", version: "~> 3.0" },
  });
  expect(terraform.required_version).toBe(">= 1.6.0");
  expect(terraform).not.toHaveProperty("encryption");
  expect(rest).not.toHaveProperty("import");
  expect(rest).not.toHaveProperty("moved");
  expect(rest).not.toHaveProperty("removed");
});
