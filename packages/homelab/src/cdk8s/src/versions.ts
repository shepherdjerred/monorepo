const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.2.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "9.3.4",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.19.2",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.34.1",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.18.3",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "81.2.1",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-adapter": "5.2.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-blackbox-exporter": "11.7.0",
  // renovate: datasource=helm registryUrl=https://pkgs.tailscale.com/helmcharts versioning=semver
  "tailscale-operator": "1.92.5",
  // renovate: datasource=github-releases versioning=semver
  "adyanth/cloudflare-operator": "v0.13.1",
  // renovate: datasource=docker registryUrl=https://quay.io versioning=docker
  "redlib/redlib":
    "latest@sha256:dffb6c5a22f889d47d8e28e33411db0fb6c5694599f72cf740c912c12f5fc1c6",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.1.3-java21@sha256:343a0349cfe04c70a95fc5a6d8c50ed69803001af58ba878e58906ca6a87d29c",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.42.2.10156-f737b826c@sha256:9c03c26b9479ba9a09935f3367459bfdc8d21545f42ed2a13258983c5be1b252",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.16.0@sha256:f55e949daad9389c98cd936285aff7529aa4b8f148cae97f738c831e7a216205",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.5.4@sha256:5af962ae633e97c8e008e4b6e638798de1420e8a9e8e6189beb108a52c6e942a",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/overseerr":
    "1.34.0@sha256:f6a782e44742a02bdb6032d32ebb4e9615e261140f879be897b28cdb40ff800e",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/prowlarr":
    "2.3.0@sha256:d3e9307b320b6772749a2cf8fc2712e9e824c4930b034680ad4d08a9e2f25884",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver-coerced
  "qdm12/gluetun":
    "v3.41@sha256:6b54856716d0de56e5bb00a77029b0adea57284cf5a466f23aad5979257d3045",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/qbittorrent":
    "4.6.7@sha256:55f15d44396315551f87294a176efae733b16e283f38980308e46073950257c6",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/radarr":
    "6.0.4@sha256:270f25698624b57b86ca119cc95399d7ff15be8297095b4e1223fd5b549b732c",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.16@sha256:02b4d538d351d6e35882a021c08e8600fe95d28860fb1dd724b597166e7221ca",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:2187e122660d6a2d451ef7c53fd4805c133133f4f47552256352c1e2a7f49ee2",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.1.1@sha256:5bb6a0870686742d00e171f36c892ba91e5994631bc363d808b9ba822262dad6",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "tailscale/golink":
    "main@sha256:ba5303fefc041cf9f11f960a90c3e16ca922dad8140ef43f704670f5c55f581b",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "home-assistant/home-assistant":
    "2026.1.2@sha256:3007eeeaf87d1e3a2047faeac6ff01dfef218b8a404bdff3ce421c1f4f363a43",
  // Custom homelab HA image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/homelab":
    "latest@sha256:8002b51df1f714254daa06035867226eb448c7e05c2ba5e2ce66e035d3e0653c",
  // Custom dependency-summary image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/dependency-summary":
    "latest@sha256:9056bf948b6f4b7e381fd8ce3824e8184114f0fd4bec943d2ab11e786b74c39b",
  // Custom better-skill-capped-fetcher image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/better-skill-capped-fetcher": "1.0.109",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/syncthing":
    "2.0.13@sha256:de603dda4513191b47d18bae93decd4683a20b212a3cd9595b2e681bb2ad9d34",
  // renovate: datasource=github-releases versioning=semver-coerced
  "dotdc/grafana-dashboards-kubernetes": "v3.0.1",
  // renovate: datasource=helm registryUrl=https://chartmuseum.github.io/charts versioning=semver
  chartmuseum: "3.10.4",
  // renovate: datasource=helm registryUrl=https://itzg.github.io/minecraft-server-charts versioning=semver
  minecraft: "5.1.0",
  // renovate: datasource=helm registryUrl=https://itzg.github.io/minecraft-server-charts versioning=semver
  "mc-router": "1.4.0",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "jorenn92/maintainerr":
    "2.19.0@sha256:bee84707edaf589cda3d18b6813cbfe3a137b52786210c3a28190e10910c1240",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  loki: "6.51.0",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  promtail: "6.17.1",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  tempo: "1.24.3",
  // renovate: datasource=helm registryUrl=https://openebs.github.io/openebs versioning=semver
  openebs: "4.4.0",
  // not managed by renovate
  "shepherdjerred/scout-for-lol/beta": "1.0.267",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod": "1.0.257",
  // not managed by renovate
  "shepherdjerred/starlight-karma-bot/beta": "1.0.29",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod": "1.0.13",
  // not managed by renovate
  "shepherdjerred/birmel": "1.0.1677",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon": "1.0.0",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.28.0@sha256:5664f42e37e7101c824806d8f73cbc97c8f406ce043bbdb8d39d4ff1e7f2ad11",
  // renovate: datasource=docker registryUrl=https://ghcr.io/buildkite/helm versioning=semver packageName=agent-stack-k8s
  "agent-stack-k8s": "0.37.1",
  // renovate: datasource=docker registryUrl=https://ghcr.io/actions/actions-runner-controller-charts versioning=semver
  "gha-runner-scale-set-controller": "0.13.1",
  // renovate: datasource=docker registryUrl=https://ghcr.io/actions/actions-runner-controller-charts versioning=semver
  "gha-runner-scale-set": "0.13.1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "actions/actions-runner":
    "2.331.0@sha256:0effcd6eb6176b786f99b102a07bd32e04cc4fac415651547cbaed54ef524290",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/python":
    "3.14-alpine@sha256:079b889b270e730f38bdbabf505362538db449a216895c2c45664b1538bd34d5",
  // renovate: datasource=docker registryUrl=https://registry.dagger.io versioning=loose
  "dagger-helm": "0.19.11",
  // renovate: datasource=helm registryUrl=https://vmware-tanzu.github.io/helm-charts versioning=semver
  velero: "11.3.2",
  // renovate: datasource=helm registryUrl=https://kyverno.github.io/kyverno versioning=semver
  kyverno: "3.6.2",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "velero/velero-plugin-for-aws":
    "v1.13.2@sha256:25c3a0a043fc396a0593a3da0aa16ed1f39df74883bda42c4588fc8877b72bde",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "openebs/velero-plugin":
    "3.6.0@sha256:9ea3331d891e436a7239e37e68ca4c8888500cb122be7cdc9d8400f345555c76",
  // renovate: datasource=github-releases versioning=semver
  "kubernetes/kubernetes": "v1.35.0",
  // renovate: datasource=custom.papermc versioning=semver
  paper: "1.21.11",
  // this is empty because we have to perform some string manipulation below
  // not managed by renovate
  dagger: "",
  // renovate: datasource=docker registryUrl=https://ghcr.io/recyclarr versioning=docker
  recyclarr:
    "7.5.2@sha256:2550848d43a453f2c6adf3582f2198ac719f76670691d76de0819053103ef2fb",
  // renovate: datasource=github-releases versioning=semver
  "siderolabs/talos": "1.12.0",
  // renovate: datasource=helm registryUrl=https://opensource.zalando.com/postgres-operator/charts/postgres-operator versioning=semver
  "postgres-operator": "1.15.1",
  // renovate: datasource=helm registryUrl=https://helm.coder.com/v2 versioning=semver
  coder: "2.29.2",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "cooperspencer/gickup":
    "0.10.39@sha256:3d0dabf3180ac8d3cc1939161e8b55947d697e453abeda29bdc42bb0319a9ed1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "esanchezm/prometheus-qbittorrent-exporter":
    "v1.6.0@sha256:b987d19693a5b2fe7314b22009c6302e084ec801fcf96afaf14065b4cdafc842",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "jsclayton/prometheus-plex-exporter":
    "main@sha256:18ef1b2197efbcb75bd7276380955760995f10a9fbe55106809a6fcff91c2940",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  redis: "24.1.2",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.0.407",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "24.0.3",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "postalserver/postal":
    "3.3.4@sha256:0945f345ee87f5e6a4eb227d47f41c223ec0aa8b06a7c24f9f60ca0f9b9e0c28",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "library/mariadb":
    "11.8@sha256:345fa26d595e8c7fe298e0c4098ed400356f502458769c8902229b3437d6da2b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "boky/postfix":
    "latest@sha256:aafc772384232497bed875e1eb66b4d3e54ba1ebc86e2e185a6dc1dbc48182ef",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/busybox":
    "latest@sha256:70ce0a747f09cd7c09c2d6eaeab69d60adb0398f569296e8c0e844599388ebd6",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/alpine":
    "latest@sha256:1882fa4569e0c591ea092d3766c4893e19b8901a8e649de7067188aba3cc0679",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "mccloud/bazarr-openai-whisperbridge":
    "latest@sha256:e6d60d008e70c3f6daaa39225db480d698c9be2c57c5857c53caae9798b1f232",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/debian":
    "bookworm-slim@sha256:56ff6d36d4eb3db13a741b342ec466f121480b5edded42e4b7ee850ce7a418ee",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "plausible/analytics":
    "v2.0.0@sha256:cd5f75e1399073669b13b4151cc603332a825324d0b8f13dfc9de9112a3c68a1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "clickhouse/clickhouse-server":
    "25.12-alpine@sha256:ae97f08909c80322db2a22cc10b33de16f949b5b4bc369b5b8de8bdfcad67e50",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "tbxark/mcp-proxy":
    "v0.43.2@sha256:1c43164a910a4f74a3ce48d95cb2ef792de8d467296555e63944fa798f0a44bd",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bugsink/bugsink":
    "2.0.12@sha256:4fcf877f17d526644f255ecad7a82ff0e30251af4dd22de1d218d768d4028a20",
  // Custom dns-audit image - Python with checkdmarc pre-installed for DNS auditing
  // not managed by renovate
  "shepherdjerred/dns-audit": "latest",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "latest@sha256:94a9083245e3e58a43646ab85a949845e46fde3ceb9eb4bbf638ee91e2a6b52f",
};

const daggerVersion = versions["dagger-helm"].split("@")[0];
if (daggerVersion == null || daggerVersion === "") {
  throw new Error("Failed to parse dagger version");
}

versions.dagger = daggerVersion;

export default versions;
