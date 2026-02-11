/**
 * Generic Minecraft server configuration loader for GitOps-managed configs.
 *
 * This loads config files from config/minecraft-{serverName} at build time and creates:
 * - ConfigMap with all server and plugin configs
 * - Volume/mount configuration for itzg's /config sync mechanism
 *
 * Uses itzg/minecraft-server's built-in config sync:
 * - Configs mounted to /config
 * - Synced to /data on startup
 * - ${CFG_*} placeholders substituted from environment variables
 */

import { Glob } from "bun";
import path from "path";
import { type Construct } from "constructs";
import { KubeConfigMap } from "../../generated/imports/k8s.ts";
import versions from "../versions.ts";

// Cache loaded configs per server to avoid re-reading
const configCache = new Map<string, Record<string, string>>();

async function loadServerConfigs(serverName: string): Promise<Record<string, string>> {
  const cached = configCache.get(serverName);
  if (cached) {
    return cached;
  }

  const configDir = new URL(`../../config/minecraft-${serverName}`, import.meta.url).pathname;
  const configs: Record<string, string> = {};

  try {
    const glob = new Glob("**/*.{yml,yaml,properties,json,conf,txt}");
    for await (const entry of glob.scan(configDir)) {
      // Validate no __ in filenames (would conflict with path encoding)
      if (entry.includes("__")) {
        throw new Error(`Config file '${entry}' contains '__' which conflicts with path encoding. Rename the file.`);
      }

      try {
        const filePath = path.join(configDir, entry);
        const content = await Bun.file(filePath).text();
        // Use double underscore as separator for ConfigMap keys (slashes not allowed)
        const key = entry.replaceAll("/", "__");
        configs[key] = content;
      } catch (fileError: unknown) {
        throw new Error(`Failed to read config file '${entry}': ${String(fileError)}`);
      }
    }
  } catch (error: unknown) {
    throw new Error(`Failed to load ${serverName} configs from '${configDir}': ${String(error)}`);
  }

  // Validate we found at least some configs
  if (Object.keys(configs).length === 0) {
    throw new Error(
      `No config files found in '${configDir}'. Expected .yml, .yaml, .properties, .json, .conf, or .txt files.`,
    );
  }

  // Validate size (ConfigMaps have 1MB limit)
  const totalSize = Object.values(configs).reduce((sum, c) => sum + c.length, 0);
  if (totalSize > 900_000) {
    throw new Error(
      `${serverName} configs too large: ${String(totalSize)} bytes (limit ~1MB). Remove translation/language files.`,
    );
  }

  configCache.set(serverName, configs);
  return configs;
}

// Pre-load all server configs at module import time
// This ensures configs are loaded synchronously when the module is used
const serverNames = ["tsmc", "sjerred", "shuxin"] as const;
type ServerName = (typeof serverNames)[number];

const loadedConfigs: Record<ServerName, Record<string, string>> = {
  tsmc: {},
  sjerred: {},
  shuxin: {},
};

// Load configs for all servers that have config directories
for (const name of serverNames) {
  try {
    loadedConfigs[name] = await loadServerConfigs(name);
  } catch (error) {
    // Config directory may not exist yet - that's OK during development
    // The error will surface when the server-specific functions are called
    console.debug(`[minecraft-config] Skipping ${name} config load: ${String(error)}`);
  }
}

function getConfigs(serverName: ServerName): Record<string, string> {
  const configs = loadedConfigs[serverName];
  if (Object.keys(configs).length === 0) {
    throw new Error(`No configs loaded for server '${serverName}'. Ensure config/minecraft-${serverName}/ exists.`);
  }
  return configs;
}

/**
 * Returns ConfigMap manifest with all server configs in a single ConfigMap.
 * @deprecated Use getMinecraftConfigMapManifests for large configs to avoid Application size limits
 */
export function getMinecraftConfigMapManifest(serverName: ServerName, namespace: string): object {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `${namespace}-configs`,
      // Note: namespace is set by ArgoCD from Application spec, not here
      labels: { "app.kubernetes.io/component": "minecraft-config" },
    },
    data: getConfigs(serverName),
  };
}

/**
 * Returns multiple ConfigMap manifests, split to avoid ArgoCD Application size limits.
 * - One ConfigMap for non-plugin configs (server.properties, bukkit.yml, etc)
 * - One ConfigMap per plugin directory
 */
export function getMinecraftConfigMapManifests(serverName: ServerName, namespace: string): object[] {
  const configs = getConfigs(serverName);
  const configMaps: object[] = [];

  // Separate plugin configs from non-plugin configs
  const nonPluginConfigs: Record<string, string> = {};
  const pluginConfigs = new Map<string, Record<string, string>>();

  for (const [key, value] of Object.entries(configs)) {
    if (key.startsWith("plugins__")) {
      // Extract plugin name (e.g., "plugins__BlueMap__core.conf" -> "BlueMap")
      const parts = key.split("__");
      const pluginName = parts[1];
      if (pluginName) {
        const existing = pluginConfigs.get(pluginName) ?? {};
        existing[key] = value;
        pluginConfigs.set(pluginName, existing);
      }
    } else {
      nonPluginConfigs[key] = value;
    }
  }

  // ConfigMap for non-plugin configs
  if (Object.keys(nonPluginConfigs).length > 0) {
    configMaps.push({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: `${namespace}-server-configs`,
        labels: { "app.kubernetes.io/component": "minecraft-config" },
      },
      data: nonPluginConfigs,
    });
  }

  // One ConfigMap per plugin
  for (const [pluginName, pluginData] of pluginConfigs) {
    configMaps.push({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: `${namespace}-plugin-${pluginName.toLowerCase()}`,
        labels: {
          "app.kubernetes.io/component": "minecraft-config",
          "app.kubernetes.io/plugin": pluginName,
        },
      },
      data: pluginData,
    });
  }

  return configMaps;
}

/**
 * Creates ConfigMaps directly as cdk8s resources (external to Helm values).
 * Use this for large configs that exceed ArgoCD Application size limits.
 * The ConfigMaps will be managed by ArgoCD but not embedded in the Helm chart.
 */
export function createMinecraftConfigMaps(scope: Construct, serverName: ServerName, namespace: string): void {
  const configs = getConfigs(serverName);

  // Separate plugin configs from non-plugin configs
  const nonPluginConfigs: Record<string, string> = {};
  const pluginConfigs = new Map<string, Record<string, string>>();

  for (const [key, value] of Object.entries(configs)) {
    if (key.startsWith("plugins__")) {
      const parts = key.split("__");
      const pluginName = parts[1];
      if (pluginName !== undefined) {
        const existing = pluginConfigs.get(pluginName) ?? {};
        existing[key] = value;
        pluginConfigs.set(pluginName, existing);
      }
    } else {
      nonPluginConfigs[key] = value;
    }
  }

  // ConfigMap for non-plugin configs
  if (Object.keys(nonPluginConfigs).length > 0) {
    new KubeConfigMap(scope, `${namespace}-server-configs`, {
      metadata: {
        name: `${namespace}-server-configs`,
        namespace,
        labels: { "app.kubernetes.io/component": "minecraft-config" },
      },
      data: nonPluginConfigs,
    });
  }

  // One ConfigMap per plugin
  for (const [pluginName, pluginData] of pluginConfigs) {
    new KubeConfigMap(scope, `${namespace}-plugin-${pluginName.toLowerCase()}`, {
      metadata: {
        name: `${namespace}-plugin-${pluginName.toLowerCase()}`,
        namespace,
        labels: {
          "app.kubernetes.io/component": "minecraft-config",
          "app.kubernetes.io/plugin": pluginName,
        },
      },
      data: pluginData,
    });
  }
}

/**
 * Returns extraVolumes array for mounting configs.
 * - Non-plugin configs go to /config (synced to /data by itzg)
 * - Plugin configs go to /plugin-configs (copied by init container to /data/plugins)
 *
 * @param useSplitConfigMaps - If true, references split ConfigMaps (one per plugin). Default false.
 */
export function getMinecraftExtraVolumes(
  serverName: ServerName,
  namespace: string,
  useSplitConfigMaps = false,
): object[] {
  const configs = getConfigs(serverName);
  const configKeys = Object.keys(configs);

  // Separate plugin configs from other configs
  const pluginKeys = configKeys.filter((key) => key.startsWith("plugins__"));
  const nonPluginKeys = configKeys.filter((key) => !key.startsWith("plugins__"));

  const volumes: object[] = [];

  // Non-plugin configs mount to /config (itzg syncs to /data)
  if (nonPluginKeys.length > 0) {
    const nonPluginItems = nonPluginKeys.map((key) => ({
      key,
      path: key.replaceAll("__", "/"),
    }));

    const configMapName = useSplitConfigMaps ? `${namespace}-server-configs` : `${namespace}-configs`;

    volumes.push({
      volumes: [
        {
          name: `${serverName}-configs`,
          configMap: {
            name: configMapName,
            items: nonPluginItems,
          },
        },
      ],
      volumeMounts: [
        {
          name: `${serverName}-configs`,
          mountPath: "/config",
          readOnly: true,
        },
      ],
    });
  }

  // Plugin configs mount to /plugin-configs (init container copies to /data/plugins)
  if (pluginKeys.length > 0) {
    if (useSplitConfigMaps) {
      // Group keys by plugin name and create one volume per plugin
      const pluginGroups = new Map<string, string[]>();
      for (const key of pluginKeys) {
        const parts = key.split("__");
        const pluginName = parts[1];
        if (pluginName) {
          const existing = pluginGroups.get(pluginName) ?? [];
          existing.push(key);
          pluginGroups.set(pluginName, existing);
        }
      }

      const allVolumes: object[] = [];
      const allMounts: object[] = [];

      for (const [pluginName, keys] of pluginGroups) {
        const volumeName = `plugin-${pluginName.toLowerCase()}`;
        const configMapName = `${namespace}-plugin-${pluginName.toLowerCase()}`;

        allVolumes.push({
          name: volumeName,
          configMap: {
            name: configMapName,
            items: keys.map((key) => ({
              key,
              // Remove "plugins__PluginName__" prefix and restore slashes
              path: key.replace(/^plugins__[^_]+__/, "").replaceAll("__", "/"),
            })),
          },
        });

        allMounts.push({
          name: volumeName,
          mountPath: `/plugin-configs/${pluginName}`,
          readOnly: true,
        });
      }

      volumes.push({
        volumes: allVolumes,
        volumeMounts: allMounts,
      });
    } else {
      // Single ConfigMap for all plugins
      const pluginItems = pluginKeys.map((key) => ({
        key,
        path: key.replace(/^plugins__/, "").replaceAll("__", "/"),
      }));

      volumes.push({
        volumes: [
          {
            name: `${serverName}-plugin-configs`,
            configMap: {
              name: `${namespace}-configs`,
              items: pluginItems,
            },
          },
        ],
        volumeMounts: [
          {
            name: `${serverName}-plugin-configs`,
            mountPath: "/plugin-configs",
            readOnly: true,
          },
        ],
      });
    }
  }

  return volumes;
}

/**
 * Returns init container that copies plugin configs from /plugin-configs to /data/plugins.
 * This bypasses itzg's /config sync which fails with DirectoryNotEmptyException when
 * /data/plugins already contains downloaded plugin JARs.
 *
 * Uses find + cp to copy individual files, merging into existing directories.
 *
 * @param useSplitConfigMaps - If true, expects split volume mounts (one per plugin). Default false.
 */
export function getMinecraftPluginConfigInitContainer(serverName: ServerName, useSplitConfigMaps = false): object {
  const configs = getConfigs(serverName);
  const pluginKeys = Object.keys(configs).filter((key) => key.startsWith("plugins__"));

  // Build volume mounts based on split or unified ConfigMaps
  const volumeMounts: object[] = [
    {
      name: "datadir",
      mountPath: "/data",
    },
  ];

  if (useSplitConfigMaps) {
    // Get unique plugin names
    const pluginNames = new Set<string>();
    for (const key of pluginKeys) {
      const parts = key.split("__");
      const pluginName = parts[1];
      if (pluginName) {
        pluginNames.add(pluginName);
      }
    }

    for (const pluginName of pluginNames) {
      volumeMounts.push({
        name: `plugin-${pluginName.toLowerCase()}`,
        mountPath: `/plugin-configs/${pluginName}`,
        readOnly: true,
      });
    }
  } else {
    volumeMounts.push({
      name: `${serverName}-plugin-configs`,
      mountPath: "/plugin-configs",
      readOnly: true,
    });
  }

  return {
    name: "copy-plugin-configs",
    image: `library/busybox:${versions["library/busybox"]}`,
    command: [
      "sh",
      "-c",
      // 1. Clear /data/config to prevent DirectoryNotEmptyException during itzg sync
      // 2. Copy plugin configs if they exist
      `rm -rf /data/config && mkdir -p /data/config
      if [ -d /plugin-configs ] && [ "$(ls -A /plugin-configs)" ]; then
        cd /plugin-configs && find -L . -type f | while read f; do
          mkdir -p "/data/plugins/$(dirname "$f")"
          cp "$f" "/data/plugins/$f"
        done
      fi`,
    ],
    volumeMounts,
  };
}

/**
 * Returns extraEnv configuration for itzg config sync.
 */
export function getMinecraftExtraEnv(): Record<string, string> {
  return {
    // itzg config sync settings
    COPY_CONFIG_DEST: "/data",
    SYNC_SKIP_NEWER_IN_DESTINATION: "true", // Preserve runtime changes
    REPLACE_ENV_DURING_SYNC: "true",
    ENV_VARIABLE_PREFIX: "CFG_",
    REPLACE_ENV_SUFFIXES: "yml,yaml,json,properties,conf,txt",
  };
}
