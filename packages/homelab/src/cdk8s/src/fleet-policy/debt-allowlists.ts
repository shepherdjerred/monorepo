/**
 * Debt allowlists for the fleet policy tests in this directory.
 *
 * Each set is the exceptions to one rule as of the day the rule was written:
 * work that is known, deferred, and tracked by being listed here. The tests
 * enforce both directions, like `misc/container-resource-allowlist.ts`: a
 * workload that breaks a rule without being listed fails, and a listed entry
 * that no longer breaks the rule fails until it is deleted. So these lists
 * only shrink. Do not add an entry to make a new workload pass; fix the
 * workload.
 */

/**
 * Synthesized workloads no Ingress NetworkPolicy selects (`<namespace>/<workload>`):
 * every pod in the cluster can connect to them.
 */
export const WORKLOADS_WITHOUT_INGRESS_POLICY: ReadonlySet<string> = new Set([
  "arcade/arcade",
  "arcade/arcade-edge",
  "ddns/ddns",
  "gickup/gickup",
  "golink/golink",
  "gradle-build-cache/gradle-build-cache",
  "node-tuning/cpu-power-cap",
  "postal/postal-postal-worker",
  "prometheus/kubernetes-event-exporter",
  "prometheus/nvme-metrics-collector",
  "prometheus/smartctl-collector",
  "prometheus/zfs-snapshots-collector",
  "prometheus/zfs-zpool-collector",
  "s3-static-sites/s3-static-sites",
  "seaweedfs/seaweedfs-backup",
  "starlight-karma-bot-beta/starlight-karma-bot-beta-starlight-karma-bot-backend",
  "starlight-karma-bot-prod/starlight-karma-bot-prod-starlight-karma-bot-backend",
  "temporal/temporal-namespace-init",
  "temporal/temporal-schema-migration",
  "turbo-cache/turbo-cache",
  "woodpecker-ci/temporal-maintenance-worker",
  "woodpecker/woodpecker-woodpecker-agent-completion",
  "woodpecker/woodpecker-woodpecker-agent-main",
  "woodpecker/woodpecker-woodpecker-agent-pr",
  "woodpecker/woodpecker-woodpecker-agent-review",
]);

/**
 * Synthesized workloads no Egress NetworkPolicy selects (`<namespace>/<workload>`):
 * they can connect anywhere.
 */
export const WORKLOADS_WITHOUT_EGRESS_POLICY: ReadonlySet<string> = new Set([
  "arcade/arcade",
  "arcade/arcade-edge",
  "buildkitd/buildkitd",
  "ddns/ddns",
  "gickup/gickup",
  "golink/golink",
  "gradle-build-cache/gradle-build-cache",
  "home/home-zwave-js-ui",
  "media/media-bazarr",
  "media/media-maintainerr",
  "media/media-plex",
  "media/media-prowlarr",
  "media/media-qbittorrent",
  "media/media-radarr",
  "media/media-recyclarr",
  "media/media-seerr",
  "media/media-sonarr",
  "media/media-streambot",
  "media/media-tautulli",
  "media/media-whisperbridge",
  "node-tuning/cpu-power-cap",
  "prometheus/kubernetes-event-exporter",
  "prometheus/nvme-metrics-collector",
  "prometheus/smartctl-collector",
  "prometheus/zfs-snapshots-collector",
  "prometheus/zfs-zpool-collector",
  "s3-static-sites/s3-static-sites",
  "seaweedfs/seaweedfs-backup",
  "starlight-karma-bot-beta/starlight-karma-bot-beta-starlight-karma-bot-backend",
  "starlight-karma-bot-prod/starlight-karma-bot-prod-starlight-karma-bot-backend",
  "turbo-cache/turbo-cache",
  "woodpecker-ci/temporal-maintenance-worker",
  "woodpecker/woodpecker-woodpecker-agent-completion",
  "woodpecker/woodpecker-woodpecker-agent-main",
  "woodpecker/woodpecker-woodpecker-agent-pr",
  "woodpecker/woodpecker-woodpecker-agent-review",
]);

/**
 * Argo Application namespaces whose pods come from an upstream chart and that
 * this repository gives no Ingress NetworkPolicy. Policies for upstream Helm
 * namespaces are deliberately deferred; they stay listed until that work lands.
 */
export const UPSTREAM_NAMESPACES_WITHOUT_INGRESS_POLICY: ReadonlySet<string> =
  new Set([
    "1password",
    "alloy",
    "alloy-gateway",
    "argocd",
    "cert-manager",
    "chartmuseum",
    "cloudflare-operator-system",
    "cloudflare-tunnel",
    "intel-device-plugin-operator",
    "kueue-system",
    "loki",
    "mc-router",
    "mc-sandbox",
    "node-feature-discovery",
    "openebs",
    "postgres-operator",
    "promtail",
    "pyroscope",
    "tailscale",
    "tempo",
    "velero",
  ]);

/**
 * As above, for Egress. The Minecraft namespaces have Ingress policies only.
 */
export const UPSTREAM_NAMESPACES_WITHOUT_EGRESS_POLICY: ReadonlySet<string> =
  new Set([
    "1password",
    "alloy",
    "alloy-gateway",
    "argocd",
    "cert-manager",
    "chartmuseum",
    "cloudflare-operator-system",
    "cloudflare-tunnel",
    "intel-device-plugin-operator",
    "kueue-system",
    "loki",
    "mc-router",
    "mc-sandbox",
    "minecraft-shuxin",
    "minecraft-sjerred",
    "minecraft-tsmc",
    "node-feature-discovery",
    "openebs",
    "postgres-operator",
    "promtail",
    "pyroscope",
    "tailscale",
    "tempo",
    "velero",
  ]);

/**
 * Long-running containers that declare a port but have neither a readiness nor
 * a startup probe (`<namespace>/<workload>/<container>`).
 */
export const PORT_CONTAINERS_WITHOUT_PROBE: ReadonlySet<string> = new Set([
  "gickup/gickup/main",
  "home/home-homeassistant/main",
  "media/media-plex/main",
  "media/media-plex/plex-exporter",
  "media/media-qbittorrent/qbittorrent-exporter",
  "postal/postal-postal-smtp/postal-smtp",
  "postal/postal-postal-web/postal-web",
  "postal/postal-postal-worker/postal-worker",
  "postal/postal-postal-worker/postfix-relay",
]);

/**
 * Workloads behind a Service in which no container has a readiness or startup
 * probe (`<namespace>/<workload>`).
 */
export const SERVED_WORKLOADS_WITHOUT_PROBE: ReadonlySet<string> = new Set([
  "freshrss/freshrss",
  "gickup/gickup",
  "home/home-homeassistant",
  "media/media-plex",
  "postal/postal-postal-smtp",
  "postal/postal-postal-web",
  "postal/postal-postal-worker",
]);

/**
 * Containers that do not set `allowPrivilegeEscalation: false`
 * (`<namespace>/<workload>/<container>`). All but
 * `kubernetes-event-exporter` are privileged by design (host device, kernel or
 * firewall access).
 */
export const CONTAINERS_ALLOWING_PRIVILEGE_ESCALATION: ReadonlySet<string> =
  new Set([
    "buildkitd/buildkitd/binfmt",
    "buildkitd/buildkitd/buildkitd",
    "home/home-zwave-js-ui/main",
    "media/media-qbittorrent/gluetun",
    "node-tuning/cpu-power-cap/cpu-power-cap",
    "prometheus/kubernetes-event-exporter/event-exporter",
    "prometheus/nvme-metrics-collector/nvme-metrics-collector",
    "prometheus/smartctl-collector/smartctl-collector",
    "prometheus/zfs-snapshots-collector/zfs-snapshots-collector",
    "prometheus/zfs-zpool-collector/zfs-zpool-collector",
  ]);

/**
 * Containers with no seccomp profile from their own or their pod's security
 * context (`<namespace>/<workload>/<container>`). Most of the fleet predates the
 * `RuntimeDefault` baseline; hardening PRs remove entries service by service.
 */
export const CONTAINERS_WITHOUT_SECCOMP: ReadonlySet<string> = new Set([
  "arcade/arcade/main",
  "birmel/birmel/code-sandbox",
  "birmel/birmel/install-code-sandbox-firewall",
  "birmel/birmel/main",
  "bugsink/bugsink/bugsink",
  "bugsink/bugsink/migrate",
  "bugsink/bugsink/migrate-snappea",
  "bugsink/bugsink/snappea-worker",
  "buildkitd/buildkitd/binfmt",
  "buildkitd/buildkitd/buildkitd",
  "ddns/ddns/ipv4-ddns",
  "ddns/ddns/main",
  "delivery/delivery/delivery",
  "delivery/delivery/migrate",
  "freshrss/freshrss/main",
  "gickup/gickup/main",
  "glitter-boys-launcher/glitter-boys-launcher-service/glitter-boys-launcher",
  "golink/golink/main",
  "gradle-build-cache/gradle-build-cache/gradle-build-cache",
  "gradle-build-cache/gradle-build-cache/prepare",
  "home/home-eufy-security-ws/main",
  "home/home-homeassistant/install-adaptive-lighting",
  "home/home-homeassistant/install-custom-brand-icons",
  "home/home-homeassistant/install-dreo",
  "home/home-homeassistant/install-emporia-vue",
  "home/home-homeassistant/install-eufy-security",
  "home/home-homeassistant/install-kumo",
  "home/home-homeassistant/install-mysa",
  "home/home-homeassistant/install-petlibro",
  "home/home-homeassistant/install-sonoff",
  "home/home-homeassistant/main",
  "home/home-homeassistant/prune-stale-ha-components",
  "home/home-scrypted/main",
  "home/home-zwave-js-ui/main",
  "media/media-bazarr/configure-subtitle-providers",
  "media/media-bazarr/main",
  "media/media-maintainerr/main",
  "media/media-media-files/media-files",
  "media/media-media-network/media-network",
  "media/media-plex/main",
  "media/media-plex/plex-exporter",
  "media/media-prowlarr/main",
  "media/media-qbittorrent/gluetun",
  "media/media-qbittorrent/qbittorrent",
  "media/media-qbittorrent/qbittorrent-config-seed",
  "media/media-qbittorrent/qbittorrent-exporter",
  "media/media-radarr/main",
  "media/media-recyclarr/main",
  "media/media-recyclarr/render-config",
  "media/media-sonarr/main",
  "media/media-streambot/streambot",
  "media/media-tautulli/main",
  "media/media-whisperbridge/main",
  "node-tuning/cpu-power-cap/cpu-power-cap",
  "pinchtab/pinchtab/install-browser-firewall",
  "pinchtab/pinchtab/main",
  "postal/postal-postal-smtp/postal-smtp",
  "postal/postal-postal-web/postal-web",
  "postal/postal-postal-worker/postal-worker",
  "postal/postal-postal-worker/postfix-relay",
  "prometheus/kubernetes-event-exporter/event-exporter",
  "prometheus/nvme-metrics-collector/nvme-metrics-collector",
  "prometheus/smartctl-collector/smartctl-collector",
  "prometheus/zfs-snapshots-collector/zfs-snapshots-collector",
  "prometheus/zfs-zpool-collector/zfs-zpool-collector",
  "redlib/redlib/main",
  "relay/relay/relay-server",
  "s3-static-sites/s3-static-sites/caddy",
  "scout-beta/scout-beta-scout-activity-worker/main",
  "scout-beta/scout-beta-scout-backend/main",
  "scout-beta/scout-beta-scout-gateway/main",
  "scout-beta/scout-beta-scout-workflow-worker-candidate/scout-workflow-worker-candidate",
  "scout-prod/scout-prod-scout-activity-worker/main",
  "scout-prod/scout-prod-scout-backend/main",
  "scout-prod/scout-prod-scout-gateway/main",
  "scout-prod/scout-prod-scout-workflow-worker-candidate/scout-workflow-worker-candidate",
  "seaweedfs/seaweedfs-backup/filer-backup",
  "starlight-karma-bot-beta/starlight-karma-bot-beta-starlight-karma-bot-backend/main",
  "starlight-karma-bot-prod/starlight-karma-bot-prod-starlight-karma-bot-backend/main",
  "syncthing/syncthing/main",
  "tasknotes/tasknotes/obsidian-headless",
  "tasknotes/tasknotes/tasknotes-server",
  "temporal/temporal-delivery-platform-worker/temporal-delivery-platform-worker",
  "temporal/temporal-delivery-worker/temporal-delivery-worker",
  "temporal/temporal-delivery-workflows/temporal-delivery-workflows",
  "temporal/temporal-namespace-init/namespace-init",
  "temporal/temporal-schema-migration/schema-migration",
  "temporal/temporal-temporal-agent-worker/install-provider-firewall",
  "temporal/temporal-temporal-agent-worker/temporal-agent-worker",
  "temporal/temporal-temporal-billing-worker/temporal-billing-worker",
  "temporal/temporal-temporal-gateway/temporal-gateway",
  "temporal/temporal-temporal-glitter-context-worker/temporal-glitter-context-worker",
  "temporal/temporal-temporal-glitter-corpus-worker/temporal-glitter-corpus-worker",
  "temporal/temporal-temporal-home-worker/temporal-home-worker",
  "temporal/temporal-temporal-infra-worker/temporal-infra-worker",
  "temporal/temporal-temporal-promotion-worker/install-provider-firewall",
  "temporal/temporal-temporal-repo-worker/temporal-repo-worker",
  "temporal/temporal-temporal-reports-worker/temporal-reports-worker",
  "temporal/temporal-temporal-scout-worker/temporal-scout-worker",
  "temporal/temporal-temporal-server/temporal-server",
  "temporal/temporal-temporal-server/temporal-server-config-render",
  "temporal/temporal-temporal-streambot-worker/temporal-streambot-worker",
  "temporal/temporal-temporal-ui/temporal-ui",
  "temporal/temporal-temporal-workflows-candidate/temporal-workflows-candidate",
  "trmnl-dashboard/trmnl-dashboard/trmnl-dashboard",
  "turbo-cache/turbo-cache/turbo-cache",
  "woodpecker-ci/temporal-maintenance-worker/copy-kometa-config",
  "woodpecker-ci/temporal-maintenance-worker/temporal-maintenance-worker",
  "woodpecker/woodpecker-woodpecker-agent-completion/woodpecker-agent",
  "woodpecker/woodpecker-woodpecker-agent-main/woodpecker-agent",
  "woodpecker/woodpecker-woodpecker-agent-pr/woodpecker-agent",
  "woodpecker/woodpecker-woodpecker-agent-review/woodpecker-agent",
  "woodpecker/woodpecker-woodpecker-config-extension/woodpecker-config-extension",
  "woodpecker/woodpecker-woodpecker-server/woodpecker-server",
]);

/**
 * Registered probe ports a NetworkPolicy closes to one of the peers that
 * connect to them (`<namespace>/<service>:<port> from <source namespace>`):
 * blackbox-exporter in `prometheus`, the Tailscale proxy in `tailscale`, or
 * cloudflared in `cloudflare-tunnel`.
 */
export const PROBE_PORTS_NOT_ADMITTED: ReadonlySet<string> = new Set([
  // The policy admits the `cloudflare-tunnel` namespace
  // (`cloudflareTunnelIngressRule`), where no cloudflared pod runs.
  "bugsink/bugsink-bugsink-service:8000 from cloudflare-operator-system",
  "freshrss/freshrss-service:80 from cloudflare-operator-system",
  "glitter-boys-launcher/glitter-boys-launcher-http:8080 from cloudflare-operator-system",
  "home/home-homeassistant-service:8123 from cloudflare-operator-system",
  "media/media-plex-service:32400 from cloudflare-operator-system",
  "media/media-seerr-service:5055 from cloudflare-operator-system",
  "media/streambot-web:8080 from cloudflare-operator-system",
  "relay/relay-relay-service:8080 from cloudflare-operator-system",
  "temporal/temporal-worker-agent-tasks:9467 from cloudflare-operator-system",
  "temporal/temporal-worker-gh-webhook:9466 from cloudflare-operator-system",
  "temporal/temporal-worker-sleep-webhook:9469 from cloudflare-operator-system",
  "temporal/temporal-worker-xcode-cloud-webhook:9468 from cloudflare-operator-system",
  "trmnl-dashboard/trmnl-dashboard-trmnl-dashboard-service:3000 from cloudflare-operator-system",
  "woodpecker/woodpecker-server:8000 from cloudflare-operator-system",
  // The gateway's webhook ports are opened to the tunnel only
  // (`temporal-gateway-ingress-netpol`), not to blackbox-exporter.
  "temporal/temporal-worker-agent-tasks:9467 from prometheus",
  "temporal/temporal-worker-gh-webhook:9466 from prometheus",
  "temporal/temporal-worker-sleep-webhook:9469 from prometheus",
  "temporal/temporal-worker-xcode-cloud-webhook:9468 from prometheus",
]);
