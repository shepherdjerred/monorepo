import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const DISCORD_INTEGRATION_MOD_URL = versions["mc2discord-forge-1.12.2"];

const configPath = new URL("mc2discord-config.toml", import.meta.url).pathname;
const configTemplate = await Bun.file(configPath).text();

export function getDiscordIntegrationConfigMapManifest(name: string): object {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: `${name}-discord-integration-config` },
    data: { "mc2discord.toml": configTemplate },
  };
}

export function getDiscordIntegrationExtraVolumes(name: string): object[] {
  return [
    {
      volumes: [
        {
          name: "discord-integration-template",
          configMap: {
            name: `${name}-discord-integration-config`,
          },
        },
        {
          name: "discord-integration-generated",
          emptyDir: {},
        },
      ],
      volumeMounts: [
        {
          name: "discord-integration-generated",
          mountPath: "/data/config/mc2discord.toml",
          subPath: "mc2discord.toml",
        },
      ],
    },
  ];
}

export function getDiscordIntegrationConfigInitContainer(
  secretName: string,
): object {
  return {
    name: "configure-discord-integration",
    image: `itzg/minecraft-server:${versions["itzg/minecraft-server-java8"]}`,
    command: [
      "sh",
      "-ec",
      `if [ -f /data/mods/dcintegration-forge-2.4.7.1-1.12.jar ]; then
  rm /data/mods/dcintegration-forge-2.4.7.1-1.12.jar
fi
mkdir -p /data/config
exec mc-image-helper sync-and-interpolate \
  --replace-env-prefix=CFG_ \
  --replace-env-file-suffixes=toml \
  /discord-integration-template /discord-integration-generated`,
    ],
    env: [
      {
        name: "CFG_DISCORD_BOT_TOKEN",
        valueFrom: {
          secretKeyRef: { name: secretName, key: "DISCORD_BOT_TOKEN" },
        },
      },
      {
        name: "CFG_DISCORD_CHANNEL_ID",
        valueFrom: {
          secretKeyRef: { name: secretName, key: "DISCORD_CHANNEL_ID" },
        },
      },
    ],
    resources: {
      requests: { cpu: "10m", memory: "32Mi" },
      limits: { memory: "128Mi" },
    },
    volumeMounts: [
      { name: "datadir", mountPath: "/data" },
      {
        name: "discord-integration-template",
        mountPath: "/discord-integration-template",
        readOnly: true,
      },
      {
        name: "discord-integration-generated",
        mountPath: "/discord-integration-generated",
      },
    ],
  };
}
