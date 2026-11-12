import type { Construct } from "constructs";
import {
  Fn,
  Op,
  TerraformLocal,
  TerraformOutput,
  TerraformVariable,
  Token,
} from "cdktn";
import { ApplicationSettings } from "#generated/providers/discord/application-settings/index.ts";
import { DataDiscordCurrentApplication } from "#generated/providers/discord/data-discord-current-application/index.ts";
import { DiscordProvider } from "#generated/providers/discord/provider/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { adopt } from "#src/state-migrations.ts";

/**
 * The six bot applications, by their key in `discord/desired-state.json`.
 * A provider alias, and so each address, is the key with underscores.
 */
export const DISCORD_BOTS = [
  "birmel",
  "starlight-beta",
  "starlight-prod",
  "scout-beta",
  "scout-prod",
  "minecraft",
] as const;

const SETTINGS_TYPE = `map(object({
    application_name                  = string
    expected_application_id           = string
    vault_item_id                     = string
    vault_field                       = optional(string, "DISCORD_TOKEN")
    description                       = optional(string)
    custom_install_url                = optional(string)
    interactions_endpoint_url         = optional(string)
    role_connections_verification_url = optional(string)
    tags                              = optional(set(string), [])
  }))`;

/**
 * Imported Discord bot application settings. The stack is import-only: every
 * application has `prevent_destroy` and none is created or deleted here. See
 * `src/tofu/README.md`.
 */
export class DiscordStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "discord", {
      requiredVersion: ">= 1.11.0",
      providerConstraints: { discord: "0.1.3" },
    });

    const bots = new TerraformVariable(this, "discord_bots", {
      description:
        "Import-only Discord applications and their desired settings",
      type: SETTINGS_TYPE,
    });
    const declared = Fn.toset(Fn.keys(bots.value));
    const expected = Fn.toset([...DISCORD_BOTS]);
    bots.addValidation({
      condition: Op.and(
        Op.eq(Fn.lengthOf(Fn.setsubtract(declared, expected)), 0),
        Op.eq(Fn.lengthOf(Fn.setsubtract(expected, declared)), 0),
      ),
      errorMessage:
        "discord_bots must contain exactly the six statically configured bot applications.",
    });

    const tokens = new TerraformVariable(this, "discord_bot_tokens", {
      description: "Discord bot tokens keyed by the committed application name",
      type: "map(string)",
      sensitive: true,
    });

    encryptStateAndPlans(this, {
      description:
        "OpenTofu state and plan encryption passphrase from 1Password",
      errorMessage:
        "The OpenTofu state encryption passphrase must be at least 16 characters.",
    });

    // The local shares its name with the variable it copies.
    new TerraformLocal(
      this,
      "local_discord_bots",
      bots.value,
    ).overrideLogicalId("discord_bots");

    const applicationIds: Record<string, string> = {};
    for (const bot of DISCORD_BOTS) {
      const name = bot.replaceAll("-", "_");
      // A raw expression is passed through as a whole attribute value.
      const setting = (attribute: string) =>
        `\${try(local.discord_bots["${bot}"].${attribute}, null)}`;

      // Each bot token authenticates only its own application, so every bot
      // has its own provider configuration.
      const provider = new DiscordProvider(this, `discord_${name}`, {
        alias: name,
        botToken: Token.asString(Fn.lookupNested(tokens.value, [bot])),
      });

      // Construct ids are unique across resource types in one scope.
      const application = new DataDiscordCurrentApplication(
        this,
        `current_application_${name}`,
        { provider },
      );
      application.overrideLogicalId(name);
      applicationIds[name] = application.id;

      const settings = new ApplicationSettings(
        this,
        `application_settings_${name}`,
        {
          provider,
          description: setting("description"),
          customInstallUrl: setting("custom_install_url"),
          interactionsEndpointUrl: setting("interactions_endpoint_url"),
          roleConnectionsVerificationUrl: setting(
            "role_connections_verification_url",
          ),
          lifecycle: {
            precondition: [
              {
                condition: `\${data.discord_current_application.${name}.id == local.discord_bots["${bot}"].expected_application_id}`,
                errorMessage: `The ${bot} token resolved to an unexpected Discord application ID.`,
              },
            ],
          },
        },
      );
      settings.overrideLogicalId(name);
      settings.addOverride("tags", `\${local.discord_bots["${bot}"].tags}`);
      adopt(settings, "self");
    }

    new TerraformOutput(this, "discord_application_ids", {
      description: "Application IDs verified from each configured bot token",
      value: applicationIds,
    });
  }
}
