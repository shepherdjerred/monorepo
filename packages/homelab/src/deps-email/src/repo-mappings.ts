/**
 * Mappings between dependency names and their GitHub repositories.
 * Used for fetching release notes from the correct source.
 */

// Map of Helm charts to their GitHub repos for chart release notes
export const HELM_CHART_GITHUB_REPOS: Record<string, string> = {
  "argo-cd": "argoproj/argo-helm",
  "cert-manager": "cert-manager/cert-manager",
  coder: "coder/coder",
  velero: "vmware-tanzu/helm-charts",
  "kube-prometheus-stack": "prometheus-community/helm-charts",
  openebs: "openebs/openebs",
  "tailscale-operator": "tailscale/tailscale",
  loki: "grafana/helm-charts",
  promtail: "grafana/helm-charts",
  tempo: "grafana/helm-charts",
  chartmuseum: "helm/chartmuseum",
  minecraft: "itzg/minecraft-server-charts",
  "node-feature-discovery": "kubernetes-sigs/node-feature-discovery",
  "prometheus-adapter": "kubernetes-sigs/prometheus-adapter",
  "postgres-operator": "zalando/postgres-operator",
  connect: "1Password/connect-helm-charts",
  "intel-device-plugins-operator": "intel/helm-charts",
};

// Map of Helm charts to underlying app GitHub repos (for app version release notes)
export const HELM_CHART_APP_REPOS: Record<string, string> = {
  "argo-cd": "argoproj/argo-cd",
  "cert-manager": "cert-manager/cert-manager",
  coder: "coder/coder",
  velero: "vmware-tanzu/velero",
  "kube-prometheus-stack": "prometheus/prometheus", // Main app
  openebs: "openebs/openebs",
  "tailscale-operator": "tailscale/tailscale",
  loki: "grafana/loki",
  promtail: "grafana/loki",
  tempo: "grafana/tempo",
  chartmuseum: "helm/chartmuseum",
  minecraft: "itzg/docker-minecraft-server",
  "node-feature-discovery": "kubernetes-sigs/node-feature-discovery",
  "prometheus-adapter": "kubernetes-sigs/prometheus-adapter",
  "postgres-operator": "zalando/postgres-operator",
  connect: "1Password/connect",
  "intel-device-plugins-operator": "intel/intel-device-plugins-for-kubernetes",
};

// Map of Docker images to their GitHub repos
export const DOCKER_IMAGE_GITHUB_REPOS: Record<string, string> = {
  "home-assistant/home-assistant": "home-assistant/core",
  "linuxserver/bazarr": "morpheus65535/bazarr",
  "linuxserver/sonarr": "Sonarr/Sonarr",
  "linuxserver/radarr": "Radarr/Radarr",
  "linuxserver/prowlarr": "Prowlarr/Prowlarr",
  "linuxserver/syncthing": "syncthing/syncthing",
  "linuxserver/overseerr": "sct/overseerr",
  "linuxserver/tautulli": "Tautulli/Tautulli",
  "linuxserver/qbittorrent": "qbittorrent/qBittorrent",
  "jorenn92/maintainerr": "jorenn92/maintainerr",
  "qdm12/gluetun": "qdm12/gluetun",
  "cooperspencer/gickup": "cooperspencer/gickup",
  recyclarr: "recyclarr/recyclarr",
  "freshrss/freshrss": "FreshRSS/FreshRSS",
  "dagger-helm": "dagger/dagger",
  "tailscale/golink": "tailscale/golink",
};
