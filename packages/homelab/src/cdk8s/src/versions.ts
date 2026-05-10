const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "9.5.13",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.20.2",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.35.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.18.3",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "84.5.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-adapter": "5.3.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-blackbox-exporter": "11.10.0",
  // renovate: datasource=helm registryUrl=https://pkgs.tailscale.com/helmcharts versioning=semver
  "tailscale-operator": "1.96.5",
  // renovate: datasource=github-releases versioning=semver
  "adyanth/cloudflare-operator": "v0.13.1",
  // renovate: datasource=docker registryUrl=https://quay.io versioning=docker
  // Tracked via the rolling `latest` tag because upstream redlib only publishes
  // sha-<short-commit> tags, which Renovate cannot version-compare. The global
  // pinDigests rule (renovate.json) keeps the @sha256 fresh as `latest` moves.
  "redlib/redlib":
    "latest@sha256:e6647a94d553bf3f7c95c53fc6d9da5785e6c278d9002e99ea32abdb5e3c513a",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.5.0-java21@sha256:636e25794e3ca4c1e4bbb3686f7ad0b10c4f1508802b7956803a889912891303",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.1.10611-1e34174b1-amd64@sha256:7fe30c0ca399103535e6a5b10207aa2b72d053c652763ee2ce69d082db797d74",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.1@sha256:7077fd6654547c225ca5a740c4c954379129589f875c84cbe138641d4dd8a9d9",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.5.6@sha256:7adfe3ede9ce3562098a6f944fb644da16bdf245220e707260f89f1507c87b54",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/overseerr":
    "1.35.0@sha256:6108ed066d4a919c05251d9dab041c1e55e67ff7247e7b31be97b65ffcbaeeb1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/prowlarr":
    "2.3.5@sha256:4b52038b7b6452a20c145239fa07d8218d1541d736a96c43aa0a5f60141cab28",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver-coerced
  "qdm12/gluetun":
    "v3.41.1@sha256:1a5bf4b4820a879cdf8d93d7ef0d2d963af56670c9ebff8981860b6804ebc8ab",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  // Keep this on qBittorrent app versions only. LinuxServer also publishes
  // stale OS-style tags like 20.04.1 that resolve to old app builds.
  "linuxserver/qbittorrent":
    "5.2.0@sha256:8bff8880f4e056c068ac6359de4cbcf44fb4811493cf15d83c1341fa05a515c0",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/radarr":
    "6.1.1@sha256:15417a594ebda4c660a9fa9748e7199d33e2d17b31bbc5ad7ba2e86f0b414763",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.17@sha256:60f3b6b5c7647ba2bafd81163acfe34b11117b9b834ebd7fbcc3e5f1b309c7ef",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:73edef388bab61c5a1df8171d5f3a0bd6b398e24e4baec752d63e1cd4044ecea",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.3.0@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0",
  // not managed by renovate
  "shepherdjerred/golink":
    "main@sha256:3a204341938acc2cf78da4311487875e604643320a4143d6fd0dfd3eb6102822",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "home-assistant/home-assistant":
    "2026.5.1@sha256:d4fbec16196d5c8bedf32647f0ca7165f654d92a2e81f35a373508d3226cb867",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bropat/eufy-security-ws":
    "2.1.0@sha256:886da4bc8ff070b63bb88cea3b535e512240e54f14313fa8c2890c843abd9605",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "zwavejs/zwave-js-ui":
    "11.17.0@sha256:79827886d44929105b625b07ce9870e739502d8b421bff5b11a4c17f811fb577",
  // renovate: datasource=github-releases versioning=semver
  "fuatakgun/eufy_security": "v8.2.4",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/syncthing":
    "2.0.16@sha256:237fd79ce3f1e1cc9e80317024f65a396cb5b759e2a827ca80010b24fbe37659",
  // renovate: datasource=github-releases versioning=semver-coerced
  "dotdc/grafana-dashboards-kubernetes": "v3.0.6",
  // renovate: datasource=helm registryUrl=https://chartmuseum.github.io/charts versioning=semver
  chartmuseum: "3.10.4",
  // renovate: datasource=helm registryUrl=https://itzg.github.io/minecraft-server-charts versioning=semver
  minecraft: "5.1.3",
  // renovate: datasource=helm registryUrl=https://itzg.github.io/minecraft-server-charts versioning=semver
  "mc-router": "1.5.0",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "jorenn92/maintainerr":
    "2.19.0@sha256:bee84707edaf589cda3d18b6813cbfe3a137b52786210c3a28190e10910c1240",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  loki: "7.0.0",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  promtail: "6.17.1",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  tempo: "1.24.4",
  // renovate: datasource=helm registryUrl=https://openebs.github.io/openebs versioning=semver
  openebs: "4.4.0",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/scout-for-lol/beta":
    "2.0.0-1886@sha256:680fd7fae60e4d30b1cab7baaaf1a5908e8be4f0b8bde80917e47c80dea3a664",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-1904@sha256:3f0baa5c79a06d30cd172bc76925195fcd03eaf808419c3205c21a2eea7b0190",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-1750@sha256:979a9a8653ad228088fd566d74227e1a4c6b0fab0b03881257439058c9158b33",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-1904@sha256:f722a858ec67670e76f708cbb4932a2649c9f98e3132124a681ff1cad1b7df56",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-1750@sha256:c1c6b3176da03e7f608186fe20824bc8c35c528e2756df2c2329d2e2cf3d098a",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-1750@sha256:094adf3a1387160f836422b2c762c25f02a48deee33b9be13bcf2903c3cfdcb6",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.29.0@sha256:cca8988d05cd449e1c6c69405971b1e6fc2c2116ceeb45c9fa3fc33837997a75",
  // renovate: datasource=docker registryUrl=https://ghcr.io/buildkite/helm versioning=semver packageName=agent-stack-k8s
  "agent-stack-k8s":
    "0.43.1@sha256:aee3771c2f19ad138b041d3fa5785a738214dcc64195b6417459fe721defec16",
  // renovate: datasource=docker registryUrl=https://registry.dagger.io versioning=semver packageName=dagger-helm
  "dagger-helm": "0.20.8",
  // renovate: datasource=docker registryUrl=https://registry.k8s.io versioning=semver packageName=kueue/charts/kueue
  kueue:
    "0.17.2@sha256:70df8358acb05a89bb9b9123278183d9b054851d65601498f5c42b1513cc878b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/python":
    "3.14-alpine@sha256:dd4d2bd5b53d9b25a51da13addf2be586beebd5387e289e798e4083d94ca837a",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bitnamilegacy/kubectl":
    "1.33.4@sha256:ed0b31a0508da84ee655c5c6e01bd3897fc56ad6cf69debb27fa1893a06d2246",
  // renovate: datasource=helm registryUrl=https://vmware-tanzu.github.io/helm-charts versioning=semver
  velero: "12.0.1",
  // renovate: datasource=helm registryUrl=https://kyverno.github.io/kyverno versioning=semver
  kyverno: "3.8.0",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "velero/velero-plugin-for-aws":
    "v1.14.0@sha256:7e82f717f44e89671212e0dfce7e061321c386ea84a33bca64a671670ca6c278",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "openebs/velero-plugin":
    "3.6.0@sha256:9ea3331d891e436a7239e37e68ca4c8888500cb122be7cdc9d8400f345555c76",
  // renovate: datasource=github-releases versioning=semver
  "kubernetes/kubernetes": "v1.36.0",
  // renovate: datasource=custom.papermc versioning=semver
  paper: "26.1.2",
  // renovate: datasource=docker registryUrl=https://ghcr.io/recyclarr versioning=docker
  recyclarr:
    "8.6.0@sha256:3c38ceeb54438dd8327e4e65c9b48ba601a6d20fff833342d93c9b0bc4b1930b",
  // renovate: datasource=github-releases versioning=semver
  "siderolabs/talos": "1.13.0",
  // renovate: datasource=helm registryUrl=https://opensource.zalando.com/postgres-operator/charts/postgres-operator versioning=semver
  "postgres-operator": "1.15.1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "cooperspencer/gickup":
    "0.10.42@sha256:f46a0710ae0c9e931c93b9b8f092793253e73add93d86f63d3af646b7ec0f5e4",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "esanchezm/prometheus-qbittorrent-exporter":
    "v1.6.0@sha256:b987d19693a5b2fe7314b22009c6302e084ec801fcf96afaf14065b4cdafc842",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "jsclayton/prometheus-plex-exporter":
    "main@sha256:18ef1b2197efbcb75bd7276380955760995f10a9fbe55106809a6fcff91c2940",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  redis: "25.5.2",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.23.0",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "25.1.1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "postalserver/postal":
    "3.3.6@sha256:55fa8fcc8b1e40dd07e5ba9d1c421ab7e5b4b4d5675371584dd7699a131e1c59",
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
    "bookworm-slim@sha256:67b30a61dc87758f0caf819646104f29ecbda97d920aaf5edc834128ac8493d3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "plausible/analytics":
    "v2.0.0@sha256:cd5f75e1399073669b13b4151cc603332a825324d0b8f13dfc9de9112a3c68a1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "clickhouse/clickhouse-server":
    "26.4-alpine@sha256:b802bd0194e477ce96e0474d7ca7050cb393dac9502d504a59ed47c8614c750e",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "tbxark/mcp-proxy":
    "v0.43.2@sha256:1c43164a910a4f74a3ce48d95cb2ef792de8d467296555e63944fa798f0a44bd",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bugsink/bugsink":
    "2.1.3@sha256:cf9ad368d436f0e9dd6e686d0becf5062cc079518efbf032a084c5f73fcf7754",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "2.0.0-1874@sha256:90a71e92d90462bedadaa1e2082cc1a86b0c87f75ee34f8d60fb7d5b9a46039e",
  // Custom tasknotes-server image - TaskNotes API server for mobile app
  // not managed by renovate
  "shepherdjerred/tasknotes-server":
    "2.0.0-1750@sha256:a188bc261fabbfc88a2cd132860284272de022bc9d371dd573154c0588b85ef9",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-1874@sha256:0888bf45d65c192f908e594d99c4237d46500f7e2108aee7720c49e5544e98e7",
  // Custom status-page-api image - Status page API
  // not managed by renovate
  "shepherdjerred/status-page-api":
    "1.1.138@sha256:d8a35c286800ea21b880389b0405e333c8428c1c7af50dabe947f7ff9ca6a745",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/auto-setup":
    "1.29.6@sha256:1263120feed69d82e4ca23b8ca6f1d702c3029fe70714e382966d0192318eab6",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/ui":
    "2.49.1@sha256:a066bdf5c4de689cabaf80cc357871f1db5e6d750a6bcfc42e877b913e31ef24",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/admin-tools":
    "1.31.0@sha256:3e68adcd54195a7c1222e99f2dbc32a4fdbf44ad69e3bb48e21e85c4bf417c2e",
  // Custom temporal-worker image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/temporal-worker":
    "2.0.0-1874@sha256:f02422fff6591bc55c2395b4c3ba3788196e058996afced7da514d0bb6be1820",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  // TODO: replace `latest` with the first `2.0.0-NNNN@sha256:...` once the
  // initial trmnl-dashboard image lands in ghcr; the version-commit-back
  // step in `.dagger/src/release.ts` will rewrite this entry on every main
  // build thereafter (same pattern as `shepherdjerred/temporal-worker`).
  "shepherdjerred/trmnl-dashboard": "latest",
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
