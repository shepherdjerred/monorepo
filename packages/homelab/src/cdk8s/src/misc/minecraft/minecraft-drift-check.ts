/**
 * Config drift detection init container for Minecraft servers.
 *
 * Runs before the copy init container on pod startup. Compares the current
 * persistent volume state (/data) against repo-managed ConfigMap sources.
 * If any managed config has a real value change, the pod refuses to start
 * (exit 1) so the copy step never silently overwrites a live edit.
 *
 * The comparison is SEMANTIC (parse with yq → canonical sorted JSON), not a
 * byte compare: Spigot/Paper plugins re-serialize their configs on load
 * (reindenting, flipping quote styles, dropping the trailing newline), which a
 * byte compare flags as drift on every boot even though no value changed. The
 * check logic lives in the co-located `minecraft-config-drift-check.sh`, run
 * here via the yq image (Alpine/busybox + yq). See that script for details.
 */

import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

type ServerName = "tsmc" | "sjerred" | "shuxin";

// The drift-check logic is maintained as a standalone POSIX shell script so it
// can be exercised directly by minecraft-drift-check.test.ts. It is inlined
// into the init container's command at synth time (no extra ConfigMap/mount),
// and reads its trees from the fixed production paths when run with no args.
const DRIFT_CHECK_SCRIPT = await Bun.file(
  new URL("minecraft-config-drift-check.sh", import.meta.url),
).text();

/**
 * Returns init container that checks for config drift before the server starts.
 * If any managed config file on the persistent volume differs from the repo-managed
 * ConfigMap source, the pod refuses to start (exit 1) to prevent silent overwrites.
 *
 * @param serverName - The server whose configs to check
 * @param pluginNames - Set of plugin names that have ConfigMaps
 * @param useSplitConfigMaps - If true, expects split volume mounts (one per plugin). Default false.
 */
export function getMinecraftConfigDriftCheckInitContainer(
  serverName: ServerName,
  pluginNames: Set<string>,
  useSplitConfigMaps = false,
): object {
  // Build volume mounts: /data + /plugin-configs/* + /config
  const volumeMounts: object[] = [
    {
      name: "datadir",
      mountPath: "/data",
    },
    {
      name: `${serverName}-configs`,
      mountPath: "/config",
      readOnly: true,
    },
  ];

  if (useSplitConfigMaps) {
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
    name: "check-config-drift",
    image: `mikefarah/yq:${versions["mikefarah/yq"]}`,
    command: ["sh", "-c", DRIFT_CHECK_SCRIPT],
    volumeMounts,
  };
}
