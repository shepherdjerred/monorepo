/**
 * Config drift detection init container for Minecraft servers.
 *
 * Runs before the copy init container on pod startup. Compares the current
 * persistent volume state (/data) against repo-managed ConfigMap sources.
 * If any managed config differs, the pod refuses to start (exit 1).
 *
 * Files known to be rewritten by Paper/plugins at runtime are ignored.
 */

import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

type ServerName = "tsmc" | "sjerred" | "shuxin";

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
    image: `library/busybox:${versions["library/busybox"]}`,
    command: ["sh", "-c", DRIFT_CHECK_SCRIPT],
    volumeMounts,
  };
}

const DRIFT_CHECK_SCRIPT = `rm -f /tmp/drift

echo "=== Config drift check ==="

# Known files that Paper/plugins rewrite at runtime — skip these
is_ignored() {
  case "$1" in
    ./server.properties|./spigot.yml|./config/paper-global.yml|./config/paper-world-defaults.yml) return 0 ;;
    ./Geyser-Spigot/config.yml) return 0 ;;
    *) return 1 ;;
  esac
}

# Check plugin configs: compare /data/plugins against /plugin-configs source
if [ -d /plugin-configs ] && [ "$(ls -A /plugin-configs 2>/dev/null)" ]; then
  cd /plugin-configs && find -L . -type f -not -path '*/..*' | while read f; do
    dest="/data/plugins/$f"
    if is_ignored "$f"; then
      [ -f "$dest" ] && ! cmp -s "$f" "$dest" && echo "IGNORED (runtime-modified): $f"
    elif [ -f "$dest" ] && ! cmp -s "$f" "$dest"; then
      echo "DRIFT DETECTED: $dest differs from repo"
      diff "$f" "$dest" 2>/dev/null | head -20
      echo "---"
      echo "1" > /tmp/drift
    fi
  done
fi

# Check non-plugin configs: compare /data against /config source
if [ -d /config ] && [ "$(ls -A /config 2>/dev/null)" ]; then
  cd /config && find -L . -type f -not -path '*/..*' | while read f; do
    dest="/data/$f"
    if is_ignored "$f"; then
      [ -f "$dest" ] && ! cmp -s "$f" "$dest" && echo "IGNORED (runtime-modified): $f"
    elif [ -f "$dest" ] && ! cmp -s "$f" "$dest"; then
      echo "DRIFT DETECTED: $dest differs from repo"
      diff "$f" "$dest" 2>/dev/null | head -20
      echo "---"
      echo "1" > /tmp/drift
    fi
  done
fi

if [ -f /tmp/drift ]; then
  echo ""
  echo "=== CONFIG DRIFT DETECTED ==="
  echo "Files on the server have been modified outside of the repo."
  echo "To fix: update the repo configs, commit, and redeploy."
  echo "Refusing to start."
  exit 1
fi

echo "=== All configs match repo (or fresh deploy) ==="`;
