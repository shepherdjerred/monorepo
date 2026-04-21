const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "9.5.2",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.20.2",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.35.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.18.3",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "82.18.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-adapter": "5.3.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-blackbox-exporter": "11.9.1",
  // renovate: datasource=helm registryUrl=https://pkgs.tailscale.com/helmcharts versioning=semver
  "tailscale-operator": "1.96.5",
  // renovate: datasource=github-releases versioning=semver
  "adyanth/cloudflare-operator": "v0.13.1",
  // renovate: datasource=docker registryUrl=https://quay.io versioning=loose
  "redlib/redlib":
    "sha-ba98178@sha256:dffb6c5a22f889d47d8e28e33411db0fb6c5694599f72cf740c912c12f5fc1c6",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.4.2-java21@sha256:55d2d31aed9848756c0051dea0b001a36ea0fa2afdce892f1aab0655a6dff87b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.0.10492-121068a07@sha256:1131c4cd21fa22f8196f749f1dbb69af306776c3c83c7f5b061e51dc49bcff7f",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.0@sha256:f8a0c2069bf4393f13731e9f98835f32b0a21659686f88223836c1693036f2be",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.5.6@sha256:d736df5df0286373a26d34f47aa413cb8aeada74f6338dac372a6d37ba1b3b0d",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/overseerr":
    "1.35.0@sha256:6108ed066d4a919c05251d9dab041c1e55e67ff7247e7b31be97b65ffcbaeeb1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/prowlarr":
    "2.3.5@sha256:6df73ab9e99d0dbaad27c39d8a47c600333eebea80fcb56253a0bb8b630c8115",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver-coerced
  "qdm12/gluetun":
    "v3.41.1@sha256:1a5bf4b4820a879cdf8d93d7ef0d2d963af56670c9ebff8981860b6804ebc8ab",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/qbittorrent":
    "5.1.4@sha256:8f7a1da9644340c737e3211ecc910a416d4295076e6b2824a4afcd1f4e3576e2",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/radarr":
    "6.1.1@sha256:b01097ad2d948c9f5eca39eb60bb529e2e55b0738c4bf7db09383bef0abab59d",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.17@sha256:e6c9a091735fede0c2a205c69e7d4c2f0188eaf2bec7e42d8a26c017e5f2a910",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:80454fc9123e1517414b80493d9ac543925ab75d93899f35f9ac75fdee6c65c3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.3.0@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0",
  // not managed by renovate
  "shepherdjerred/golink":
    "main@sha256:3a204341938acc2cf78da4311487875e604643320a4143d6fd0dfd3eb6102822",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "home-assistant/home-assistant":
    "2026.4.3@sha256:ae0800c81fea16bc1241ce03bddb9c6260566e90f58b09d3e5a629e4f68bdc0b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bropat/eufy-security-ws":
    "2.1.0@sha256:886da4bc8ff070b63bb88cea3b535e512240e54f14313fa8c2890c843abd9605",
  // renovate: datasource=github-releases versioning=semver
  "fuatakgun/eufy_security": "v8.2.4",
  // Custom dependency-summary image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/dependency-summary":
    "2.0.0-1020@sha256:3d542b2c163fea7a702a9e81a58e3095ba387cd35bc551f7529d7b59802001e8",
  // Custom better-skill-capped-fetcher image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/better-skill-capped-fetcher":
    "2.0.0-1020@sha256:226ad65a086c3cd9c1ab37f642e006eb76a851c5e33d7ca2c2f63be7ac6b594e",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/syncthing":
    "2.0.16@sha256:de6958feb8caf81217832744ae9a4843efbb4dd432c6cea90077ed7a0cf97fc3",
  // renovate: datasource=github-releases versioning=semver-coerced
  "dotdc/grafana-dashboards-kubernetes": "v3.0.6",
  // renovate: datasource=helm registryUrl=https://chartmuseum.github.io/charts versioning=semver
  chartmuseum: "3.10.4",
  // renovate: datasource=helm registryUrl=https://itzg.github.io/minecraft-server-charts versioning=semver
  minecraft: "5.1.2",
  // renovate: datasource=helm registryUrl=https://itzg.github.io/minecraft-server-charts versioning=semver
  "mc-router": "1.4.1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "jorenn92/maintainerr":
    "2.19.0@sha256:bee84707edaf589cda3d18b6813cbfe3a137b52786210c3a28190e10910c1240",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  loki: "6.55.0",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  promtail: "6.17.1",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  tempo: "1.24.4",
  // renovate: datasource=helm registryUrl=https://openebs.github.io/openebs versioning=semver
  openebs: "4.4.0",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/scout-for-lol/beta":
    "2.0.0-1020@sha256:49bff89398ba9a7c216131c13364663ad451b970bafc718f907a0d1ed947846c",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-998@sha256:f849214a78371abb6dfb6fbd4f5c1cea590dde35c2f0cdf7dcfdfd3e04dce72e",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-1020@sha256:ffd7d806c4d04c3d03594be2ba9616ffb0fe44144d307b259589ae9d34ed7124",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-829@sha256:3a76672b043b5658f9b8739daf3654d9dc87da8abdc4fe9d7680631039686ab7",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-1020@sha256:3cc9cc3fc3c081efb7a16c6fc939fcfdb9c4a176d149110046b458bc830ef8e4",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-1020@sha256:df0424e0ea0327ee612b89a78d29c8e96b95da41624fda15114f3bc70df96909",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.28.1@sha256:9100f649f5c946f589f54cdb9be7a65996528f48f691ef90eb262a0e06e5a522",
  // renovate: datasource=docker registryUrl=https://ghcr.io/buildkite/helm versioning=semver packageName=agent-stack-k8s
  "agent-stack-k8s": "0.42.0",
  // renovate: datasource=docker registryUrl=https://registry.dagger.io versioning=semver packageName=dagger-helm
  "dagger-helm": "0.20.6",
  // renovate: datasource=docker registryUrl=https://registry.k8s.io versioning=semver packageName=kueue/charts/kueue
  kueue: "0.17.1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/python":
    "3.14-alpine@sha256:dd4d2bd5b53d9b25a51da13addf2be586beebd5387e289e798e4083d94ca837a",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bitnamilegacy/kubectl": "1.33.4",
  // renovate: datasource=helm registryUrl=https://vmware-tanzu.github.io/helm-charts versioning=semver
  velero: "12.0.0",
  // renovate: datasource=helm registryUrl=https://kyverno.github.io/kyverno versioning=semver
  kyverno: "3.7.1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "velero/velero-plugin-for-aws":
    "v1.14.0@sha256:7e82f717f44e89671212e0dfce7e061321c386ea84a33bca64a671670ca6c278",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "openebs/velero-plugin":
    "3.6.0@sha256:9ea3331d891e436a7239e37e68ca4c8888500cb122be7cdc9d8400f345555c76",
  // renovate: datasource=github-releases versioning=semver
  "kubernetes/kubernetes": "v1.35.4",
  // renovate: datasource=custom.papermc versioning=semver
  paper: "26.1.2",
  // renovate: datasource=docker registryUrl=https://ghcr.io/recyclarr versioning=docker
  recyclarr:
    "8.5.1@sha256:734cecf44ae9be7cf0cb05b2c1bc7da0abef9d938cc11b605e58b3146205e5c0",
  // renovate: datasource=github-releases versioning=semver
  "siderolabs/talos": "1.12.6",
  // renovate: datasource=helm registryUrl=https://opensource.zalando.com/postgres-operator/charts/postgres-operator versioning=semver
  "postgres-operator": "1.15.1",
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
  redis: "25.3.11",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.21.0",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "25.0.8",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "postalserver/postal":
    "3.3.5@sha256:850800025f66e902bfe2456531d715eaac72b72c040971b6342d4ed15a35382c",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "library/mariadb":
    "11.8@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "boky/postfix":
    "latest@sha256:aafc772384232497bed875e1eb66b4d3e54ba1ebc86e2e185a6dc1dbc48182ef",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/busybox":
    "latest@sha256:1487d0af5f52b4ba31c7e465126ee2123fe3f2305d638e7827681e7cf6c83d5e",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/alpine":
    "latest@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "mccloud/bazarr-openai-whisperbridge":
    "latest@sha256:e6d60d008e70c3f6daaa39225db480d698c9be2c57c5857c53caae9798b1f232",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/debian":
    "bookworm-slim@sha256:4724b8cc51e33e398f0e2e15e18d5ec2851ff0c2280647e1310bc1642182655d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "plausible/analytics":
    "v2.0.0@sha256:cd5f75e1399073669b13b4151cc603332a825324d0b8f13dfc9de9112a3c68a1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "clickhouse/clickhouse-server":
    "26.3-alpine@sha256:b98554227ed543d21d2cd632df77fb2060454a2caeab47929fa6118c9f8bbe2f",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "tbxark/mcp-proxy":
    "v0.43.2@sha256:1c43164a910a4f74a3ce48d95cb2ef792de8d467296555e63944fa798f0a44bd",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bugsink/bugsink":
    "2.1.2@sha256:3ec70835215cd515cbe39d5d3b36575c415abf7d122112508afe94f8047ad886",
  // Custom dns-audit image - Python with checkdmarc pre-installed for DNS auditing
  // not managed by renovate
  "shepherdjerred/dns-audit":
    "2.0.0-1020@sha256:62da157f9e21ebf5249574dedb5787bc7238bb934f2ed96f21d1076d39cf6aae",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "2.0.0-1020@sha256:299f51e2c0a17804b1a5de9aca392dcee6f4bd4c4a195107711a35dedc7ebd99",
  // Custom tasknotes-server image - TaskNotes API server for mobile app
  // not managed by renovate
  "shepherdjerred/tasknotes-server":
    "2.0.0-1020@sha256:23e0ebb02a02665f4428d7cbd4fbfbcc9313656c30cb59203712892df102d3a1",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-1020@sha256:afabb977cfd8da1f049813e28ca29d2e91cfb47afaec3aac9cc29d8e3f3ad219",
  // Custom status-page-api image - Status page API
  // not managed by renovate
  "shepherdjerred/status-page-api":
    "1.1.138@sha256:d8a35c286800ea21b880389b0405e333c8428c1c7af50dabe947f7ff9ca6a745",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/auto-setup":
    "1.29.6@sha256:d33d1402e8b895329e27a0d0e7cc2f034e0aa70f0dab6aa95b306d7ae2716f67",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/ui":
    "2.48.4@sha256:b01df917af27067914b716a347eff78d232dfd47cc2c8527c621ce85e5bc15e3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/admin-tools":
    "1.30.4@sha256:9ac15d500f4020f7cc694ecc17085dfcfc2d4b1d0d2020dbe83b6f3d49e156e0",
  // Custom temporal-worker image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/temporal-worker":
    "2.0.0-1020@sha256:3d5ab1e6429a02bda074214a59f272986fe15939a32318e96ed2c47349b40455",
};

/**
 * SHA-256 of the GitHub release tarball for `fuatakgun/eufy_security`, pinned
 * to the version above. Verified at install time by the Home Assistant init
 * container so a tampered or silently-reuploaded tag can't ship custom code
 * onto the config PVC.
 *
 * Enforced by `eufy-tarball-integrity.test.ts` (CI-only): any Renovate PR that
 * bumps `fuatakgun/eufy_security` without updating this hash will fail CI.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["fuatakgun/eufy_security"])')
 *   curl -fSL "https://github.com/fuatakgun/eufy_security/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const EUFY_TARBALL_SHA256 =
  "b744aac0ce03a8a75de5100c672957504173c20cbe2ac0fc4d09d5bc75c59411";

export default versions;
