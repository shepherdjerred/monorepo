import { App, Chart, Testing } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createRecyclarrDeployment } from "./torrents/recyclarr.ts";
import { createChartMuseumResources } from "./argo-applications/platform/chartmuseum.ts";
import { createWoodpeckerCredentialBoundaries } from "./argo-applications/ci/woodpecker-credentials.ts";
import {
  DELIVERY_PLATFORM_ITEMS,
  deliveryTofuGrants,
} from "homelab/src/delivery-platform-grants.ts";
import discord from "homelab/src/tofu/discord/desired-state.json" with { type: "json" };
import {
  collectOnePasswordTargets,
  platformDesiredStateVariables,
} from "homelab/scripts/platform-desired-state.ts";
import { STACK_MANIFEST } from "homelab/scripts/tofu/tofu-stack-manifest.ts";

test("Recyclarr and ARR provider jobs bind the same canonical credentials", async () => {
  const chart = new Chart(new App(), "recyclarr-credential-contract", {
    namespace: "media",
  });
  await createRecyclarrDeployment(chart);
  const manifests = Testing.synth(chart);
  const binding = z.object({
    kind: z.literal("OnePasswordItem"),
    metadata: z.object({ name: z.string() }),
    spec: z.object({ itemPath: z.string() }),
  });
  const bindings = manifests.flatMap((manifest) => {
    const parsed = binding.safeParse(manifest);
    return parsed.success ? [parsed.data] : [];
  });
  const grants = deliveryTofuGrants("arr");
  for (const [service, secret] of [
    ["radarr", "radarr-api-credentials"],
    ["sonarr", "sonarr-api-credentials"],
  ] as const) {
    const item = DELIVERY_PLATFORM_ITEMS[secret];
    expect(
      bindings.find(
        (entry) =>
          entry.metadata.name === "recyclarr-" + service + "-credential",
      )?.spec.itemPath,
    ).toBe("vaults/v64ocnykdqju4ui6j6pua56xw4/items/" + item.itemId);
    expect(grants).toContainEqual({
      env: service.toUpperCase() + "_API_KEY",
      secret: service + "-api-credentials",
      key: service.toUpperCase() + "_API_KEY",
    });
  }
  const serialized = JSON.stringify(manifests);
  expect(serialized).not.toContain("fu5ufvg6bx3kkcp7lqi5pmwj2a");
  expect(serialized).not.toContain("/legacy");
  expect(serialized).toContain("/credentials/radarr/api-key");
  expect(serialized).toContain("/credentials/sonarr/api-key");
});

test("ChartMuseum server and CI share one owning 1Password item", () => {
  const chart = new Chart(new App(), "chartmuseum-owner-contract");
  createChartMuseumResources(chart);
  createWoodpeckerCredentialBoundaries(chart);
  const bindings = Testing.synth(chart).flatMap((manifest) => {
    const parsed = z
      .object({
        kind: z.literal("OnePasswordItem"),
        metadata: z.object({ name: z.string() }),
        spec: z.object({ itemPath: z.string() }),
      })
      .safeParse(manifest);
    return parsed.success ? [parsed.data] : [];
  });
  const server = bindings.find(
    (item) => item.metadata.name === "chartmuseum-basic-auth",
  );
  const ci = bindings.find(
    (item) => item.metadata.name === "ci-chartmuseum-basic-auth",
  );
  expect(server?.spec.itemPath).toBe(
    "vaults/v64ocnykdqju4ui6j6pua56xw4/items/wwoism5fsvmbisv4ef47yxqy2i",
  );
  expect(ci?.spec.itemPath).toBe(server?.spec.itemPath);
  expect(
    bindings.find(
      (item) => item.metadata.name === "ci-chartmuseum-credentials",
    ),
  ).toBeUndefined();
});

test("Minecraft provider and runtime retain the same bot identity and field", () => {
  const bot = discord.discord_bots.minecraft;
  expect(
    DELIVERY_PLATFORM_ITEMS["discord-minecraft-tsmc-credentials"].itemId,
  ).toBe(bot.vault_item_id);
  expect(deliveryTofuGrants("discord")).toContainEqual({
    env: "DISCORD_MINECRAFT_BOT_TOKEN",
    secret: "discord-minecraft-tsmc-credentials",
    key: bot.vault_field,
  });
  expect(bot.expected_application_id).toBe("1119453338468089868");
  expect(JSON.stringify(DELIVERY_PLATFORM_ITEMS)).not.toContain(
    "q37vet77dfggoqbvu4bqle3gje",
  );
});

test("every Discord audit target matches its reviewed Delivery grant", () => {
  const variables = platformDesiredStateVariables(discord, "discord");
  const bots = z
    .record(
      z.string(),
      z.object({ vault_item_id: z.string(), vault_field: z.string() }),
    )
    .parse(variables["discord_bots"]);
  const grants = deliveryTofuGrants("discord");
  const sources = STACK_MANIFEST.discord.secretObject?.entries;
  const owners: Readonly<Record<string, { itemId: string }>> =
    DELIVERY_PLATFORM_ITEMS;
  expect(collectOnePasswordTargets(variables)).toHaveLength(
    Object.keys(bots).length,
  );
  for (const [name, bot] of Object.entries(bots)) {
    const grant = grants.find((entry) => entry.env === sources?.[name]);
    expect(grant, name).toBeDefined();
    expect(grant?.key, name).toBe(bot.vault_field);
    expect(
      grant === undefined ? undefined : owners[grant.secret]?.itemId,
      name,
    ).toBe(bot.vault_item_id);
    expect(collectOnePasswordTargets(variables)).toContainEqual(bot);
  }
});
