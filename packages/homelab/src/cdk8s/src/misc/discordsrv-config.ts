/**
 * DiscordSRV configuration helper for Minecraft servers.
 *
 * This creates a GitOps-friendly DiscordSRV setup using:
 * - ConfigMap with config.yml containing ${CFG_*} placeholders
 * - 1Password secret for bot token and channel IDs
 * - Environment variable substitution via itzg/minecraft-server
 *
 * Required 1Password fields:
 * - discord-bot-token: The Discord bot token
 * - discord-channel-id: The main chat channel ID
 * - discord-console-channel-id: (optional) Console channel ID
 * - discord-invite-link: (optional) Server invite link
 */

export const DISCORDSRV_PLUGIN_URL =
  "https://download.discordsrv.com/v2/DiscordSRV/DiscordSRV/release/download/latest/jar";

// Load the config template from the YAML file at module load time
const configPath = new URL("discordsrv-config.yml", import.meta.url).pathname;
const discordSrvConfigTemplate = await Bun.file(configPath).text();

/**
 * Returns the Kubernetes ConfigMap manifest for DiscordSRV config.
 */
export function getDiscordSrvConfigMapManifest(name: string): object {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `${name}-discordsrv-config`,
    },
    data: {
      "config.yml": discordSrvConfigTemplate,
    },
  };
}

/**
 * Returns the extraVolumes configuration for mounting DiscordSRV config.
 */
export function getDiscordSrvExtraVolumes(name: string): object[] {
  return [
    {
      volumes: [
        {
          name: "discordsrv-config",
          configMap: {
            name: `${name}-discordsrv-config`,
          },
        },
      ],
      volumeMounts: [
        {
          name: "discordsrv-config",
          // Mount to /plugins which syncs to /data/plugins (not /config which goes to /data/config)
          mountPath: "/plugins/DiscordSRV/config.yml",
          subPath: "config.yml",
        },
      ],
    },
  ];
}

/**
 * Returns extraEnv configuration to map 1Password secret keys to CFG_ prefixed env vars.
 * The itzg/minecraft-server container requires CFG_ prefix for variable substitution.
 *
 * 1Password field names -> Environment variables:
 * - discord-bot-token -> DISCORDSRV_TOKEN (native DiscordSRV support)
 * - discord-channel-id -> CFG_DISCORD_CHANNEL_ID
 * - discord-console-channel-id -> CFG_DISCORD_CONSOLE_CHANNEL_ID
 * - discord-invite-link -> CFG_DISCORD_INVITE_LINK
 */
export function getDiscordSrvExtraEnv(secretName: string): Record<string, object | string> {
  return {
    // Enable itzg's environment variable substitution for ${CFG_*} placeholders
    REPLACE_ENV_VARIABLES: "TRUE",
    // DiscordSRV natively reads bot token from DISCORDSRV_TOKEN env var
    DISCORDSRV_TOKEN: {
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "discord-bot-token",
        },
      },
    },
    CFG_DISCORD_CHANNEL_ID: {
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "discord-channel-id",
        },
      },
    },
    CFG_DISCORD_CONSOLE_CHANNEL_ID: {
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "discord-console-channel-id",
          optional: true,
        },
      },
    },
    CFG_DISCORD_INVITE_LINK: {
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: "discord-invite-link",
          optional: true,
        },
      },
    },
  };
}
