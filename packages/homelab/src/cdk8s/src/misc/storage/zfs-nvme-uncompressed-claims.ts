/**
 * `ZfsNvmeVolume` claims provisioned on the uncompressed `zfs-ssd` class
 * before lz4 became the default (`<namespace>/<claim name>`).
 *
 * A PVC's `storageClassName` is immutable, so moving these claims to
 * `zfs-ssd-lz4` would make ArgoCD fail the sync or force a delete and
 * recreate of the volume. They keep `zfs-ssd` in their manifests. Their
 * datasets get lz4 in place instead: `ZFSVolume.spec.compression` is editable
 * after creation, and `scripts/zfs-nvme-lz4.ts` sets it (see the wiki how-to
 * "Enable lz4 on existing NVMe volumes").
 *
 * Never add to this list. A new claim gets lz4 by default.
 */
export const ZFS_NVME_UNCOMPRESSED_CLAIMS: ReadonlySet<string> = new Set([
  "alert-dashboard/alert-dashboard-data",
  "arcade/arcade-assets",
  "arcade/arcade-database",
  "arcade/arcade-edge-data",
  "arcade/arcade-goal-auth",
  "arcade/arcade-saves",
  "birmel/birmel-pvc",
  "flipt/flipt-data",
  "freshrss/freshrss-data",
  "freshrss/freshrss-extensions",
  "golink/golink-pvc",
  "home/eufy-security-ws-pvc",
  "home/homeassistant-pvc",
  "home/scrypted-pvc",
  "home/zwave-js-ui-pvc",
  "media/bazarr-pvc",
  "media/maintainerr-pvc",
  "media/plex-pvc",
  "media/prowlarr-pvc",
  "media/qbittorrent-pvc",
  "media/radarr-pvc",
  "media/recyclarr-pvc",
  "media/seerr-pvc",
  "media/sonarr-pvc",
  "media/streambot-state-pvc",
  "media/streambot-subs-cache-pvc",
  "media/tautulli-pvc",
  "pinchtab/pinchtab-data",
  "postal/postal-pvc",
  "scout-beta/scout-storage-claim",
  "scout-prod/scout-storage-claim",
  "starlight-karma-bot-beta/starlight-karma-bot-storage-claim",
  "starlight-karma-bot-prod/starlight-karma-bot-storage-claim",
  "stash/stash-state",
  "storm-brain/storm-brain-budget",
  "storm-forum/storm-forum-database",
  "storm-forum/storm-forum-files",
  "syncthing/syncthing-config",
  "syncthing/syncthing-data",
  "tasknotes/tasknotes-vault-pvc",
]);
