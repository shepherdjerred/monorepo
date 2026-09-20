import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const configDirectory = new URL(
  "../../../config/minecraft-sjerred/dynmap/",
  import.meta.url,
);
const configuration = await Bun.file(
  new URL("configuration.txt", configDirectory),
).text();
const normalTemplate = await Bun.file(
  new URL("templates/custom-normal-lowres.txt", configDirectory),
).text();

export function getDynmapConfigMapManifest(name: string): object {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: `${name}-dynmap-config` },
    data: {
      "configuration.txt": configuration,
      "custom-normal-lowres.txt": normalTemplate,
    },
  };
}

export function getDynmapExtraVolumes(name: string): object[] {
  return [
    {
      volumes: [
        {
          name: "dynmap-config",
          configMap: { name: `${name}-dynmap-config` },
        },
      ],
      volumeMounts: [],
    },
  ];
}

export function getDynmapConfigInitContainer(): object {
  return {
    name: "configure-dynmap",
    image: `library/busybox:${versions["library/busybox"]}`,
    command: [
      "sh",
      "-ec",
      `mkdir -p /data/dynmap/templates
cp /dynmap-config/configuration.txt /data/dynmap/configuration.txt
cp /dynmap-config/custom-normal-lowres.txt /data/dynmap/templates/custom-normal-lowres.txt`,
    ],
    resources: {
      requests: { cpu: "10m", memory: "16Mi" },
      limits: { memory: "64Mi" },
    },
    volumeMounts: [
      { name: "datadir", mountPath: "/data" },
      { name: "dynmap-config", mountPath: "/dynmap-config", readOnly: true },
    ],
  };
}
