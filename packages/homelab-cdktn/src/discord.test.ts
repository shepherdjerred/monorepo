import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";
import { DISCORD_BOTS } from "#src/stacks/discord.ts";

const TOFU_ROOT = path.resolve(import.meta.dir, "../../homelab/src/tofu");

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown(),
    required_version: z.string(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  provider: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  variable: z.record(z.string(), z.record(z.string(), z.unknown())),
  locals: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.record(z.string(), z.unknown())),
  resource: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), z.unknown())),
  ),
  import: z.array(z.object({ to: z.string(), id: z.string() })),
  output: z.record(z.string(), z.record(z.string(), z.unknown())),
  moved: z.unknown().optional(),
  removed: z.unknown().optional(),
});

const DesiredStateSchema = z.looseObject({
  discord_bots: z.record(z.string(), z.unknown()),
});

async function discord() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("discord") ?? ""),
  );
}

const ALIASES = [
  "birmel",
  "starlight_beta",
  "starlight_prod",
  "scout_beta",
  "scout_prod",
  "minecraft",
];

describe("discord", () => {
  test("declares exactly the bots of the committed desired state", async () => {
    const desired = DesiredStateSchema.parse(
      await Bun.file(path.join(TOFU_ROOT, "discord/desired-state.json")).json(),
    );
    expect(Object.keys(desired.discord_bots)).toEqual([...DISCORD_BOTS]);
    expect(DISCORD_BOTS.map((bot) => bot.replaceAll("-", "_"))).toEqual(
      ALIASES,
    );
  });

  test("keeps one aliased provider per bot, authenticated by that bot's token", async () => {
    const { provider, terraform } = await discord();
    expect(Object.keys(provider)).toEqual(["discord"]);
    expect(provider["discord"]).toEqual([
      { alias: "birmel", bot_token: "${var.discord_bot_tokens.birmel}" },
      {
        alias: "starlight_beta",
        bot_token: '${var.discord_bot_tokens["starlight-beta"]}',
      },
      {
        alias: "starlight_prod",
        bot_token: '${var.discord_bot_tokens["starlight-prod"]}',
      },
      {
        alias: "scout_beta",
        bot_token: '${var.discord_bot_tokens["scout-beta"]}',
      },
      {
        alias: "scout_prod",
        bot_token: '${var.discord_bot_tokens["scout-prod"]}',
      },
      { alias: "minecraft", bot_token: "${var.discord_bot_tokens.minecraft}" },
    ]);
    // The provider is published only on the Terraform registry, so its host
    // is spelled out; the lock file records this address and constraint.
    expect(terraform.required_providers).toEqual({
      discord: {
        source: "registry.terraform.io/alpaca744/discord",
        version: "0.1.3",
      },
    });
    expect(terraform.required_version).toBe(">= 1.11.0");
  });

  test("every data source and resource keeps its address and its own provider alias", async () => {
    const { data, resource } = await discord();
    expect(Object.keys(data)).toEqual(["discord_current_application"]);
    expect(Object.keys(resource)).toEqual(["discord_application_settings"]);
    expect(
      Object.keys(data["discord_current_application"] ?? {}).toSorted(),
    ).toEqual(ALIASES.toSorted());
    expect(
      Object.keys(resource["discord_application_settings"] ?? {}).toSorted(),
    ).toEqual(ALIASES.toSorted());
    for (const [index, alias] of ALIASES.entries()) {
      const bot = DISCORD_BOTS[index] ?? "";
      expect(data["discord_current_application"]?.[alias]).toEqual({
        provider: `discord.${alias}`,
      });
      const setting = (attribute: string) =>
        `\${try(local.discord_bots["${bot}"].${attribute}, null)}`;
      expect(resource["discord_application_settings"]?.[alias]).toEqual({
        provider: `discord.${alias}`,
        description: setting("description"),
        custom_install_url: setting("custom_install_url"),
        interactions_endpoint_url: setting("interactions_endpoint_url"),
        role_connections_verification_url: setting(
          "role_connections_verification_url",
        ),
        tags: `\${local.discord_bots["${bot}"].tags}`,
        lifecycle: {
          prevent_destroy: true,
          precondition: [
            {
              condition: `\${data.discord_current_application.${alias}.id == local.discord_bots["${bot}"].expected_application_id}`,
              error_message: `The ${bot} token resolved to an unexpected Discord application ID.`,
            },
          ],
        },
      });
    }
  });

  test("keeps the six self imports, the output and no moved or removed block", async () => {
    const configuration = await discord();
    expect(configuration.import).toEqual(
      ALIASES.map((alias) => ({
        id: "self",
        to: `discord_application_settings.${alias}`,
      })),
    );
    expect(configuration.output).toEqual({
      discord_application_ids: {
        description: "Application IDs verified from each configured bot token",
        value: Object.fromEntries(
          ALIASES.map((alias) => [
            alias,
            `\${data.discord_current_application.${alias}.id}`,
          ]),
        ),
      },
    });
    expect(configuration.moved).toBeUndefined();
    expect(configuration.removed).toBeUndefined();
  });

  test("keeps the variables, the local and the encryption its state was written with", async () => {
    const { variable, locals, terraform } = await discord();
    expect(Object.keys(variable).toSorted()).toEqual([
      "discord_bot_tokens",
      "discord_bots",
      "tofu_state_encryption_passphrase",
    ]);
    expect(variable["discord_bot_tokens"]).toEqual({
      description: "Discord bot tokens keyed by the committed application name",
      type: "map(string)",
      sensitive: true,
    });
    expect(variable["discord_bots"]).toMatchObject({
      description:
        "Import-only Discord applications and their desired settings",
      validation: [
        {
          error_message:
            "discord_bots must contain exactly the six statically configured bot applications.",
        },
      ],
    });
    expect(variable["tofu_state_encryption_passphrase"]).toEqual({
      description:
        "OpenTofu state and plan encryption passphrase from 1Password",
      type: "string",
      sensitive: true,
      validation: [
        {
          condition: "${(length(var.tofu_state_encryption_passphrase) >= 16)}",
          error_message:
            "The OpenTofu state encryption passphrase must be at least 16 characters.",
        },
      ],
    });
    expect(locals).toEqual({ discord_bots: "${var.discord_bots}" });
    expect(terraform.encryption).toEqual({
      key_provider: {
        pbkdf2: {
          state: { passphrase: "${var.tofu_state_encryption_passphrase}" },
        },
      },
      method: {
        aes_gcm: { encrypted: { keys: "${key_provider.pbkdf2.state}" } },
      },
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
  });
});
