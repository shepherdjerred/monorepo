const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "9.5.14",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.20.2",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.35.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.18.3",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "85.0.2",
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
    "2026.5.4-java21@sha256:0c461abea3f54be906efab6c3e8f1dd568d32d58547474af3405c4813d2217c4",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.1.10611-1e34174b1-amd64@sha256:7fe30c0ca399103535e6a5b10207aa2b72d053c652763ee2ce69d082db797d74",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.1@sha256:97a8127cfd3be10f653cea347cef64098243e315c2d81385813b7d8fc6fc384b",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.5.6@sha256:95f27692c3de6dbe130cd035d342d8138ec74ade7b62cfc52e11ae222c52c855",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  // Kept alongside Seerr during the migration; remove once Seerr fully owns the request flow.
  "linuxserver/overseerr":
    "1.35.0@sha256:6108ed066d4a919c05251d9dab041c1e55e67ff7247e7b31be97b65ffcbaeeb1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "seerr-team/seerr":
    "v3.2.0@sha256:c4cbd5121236ac2f70a843a0b920b68a27976be57917555f1c45b08a1e6b2aad",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "jellyfin/jellyfin":
    "10.11.8@sha256:93227545077893cc9516f28b3adb733b67bc4691f41b6167428a2a0e3220b81c",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "kometateam/kometa":
    "v2.3.1@sha256:683c04827ef3fecf1cc5cb178f75f91f968aef6c6d89d34bc9c70966fd1d7259",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/prowlarr":
    "2.3.5@sha256:c9fe528f34b1fd3715438b6f6d6991d64e2965f2c055db36398bc66a0e7eab01",
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
    "6.1.1@sha256:079e48870584baf2a3e7e43e7ba6d3c834555931851a59c82c51cc792d285caf",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.17@sha256:0b5c4803f92456fb9b65bae8375716ea120b4ea17b3cced7da32b63f0085782b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:37c99677e997710c1bbe9d74c93f2e3b8de3457a5ca6e28643e251b38ed05311",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.5.0@sha256:59bab8d3aceec09bf6bdb07d6beca0225ca5cd7ab79436a87ea97978fe1dc4f9",
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
    "2.1.0@sha256:833b349a4247d10c4740aa3264df289537e0091e778ceefc2998ec694770f706",
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
    "2.0.0-3072@sha256:599931c92901247c7132023ba33d8628d0ebeb24d1108e72bdb755f149e98318",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-2985@sha256:8b66f27b0daaff642a2ac838e838e8f8ccd64a21e2f9e09fb69730c1bbf8ff36",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-3072@sha256:99afa3b5d37b60973bc3c280f78bb0206547275f8bdb2493719ba89a0c37432e",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-2970@sha256:89b85d616852f61f17a5201378d0adb812b68d1255ddbe221a6f31670b9c36c2",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-3072@sha256:acaf19e765478901a21aad7e6f20ef08ba5245539b49a86748fbac22859644b9",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-3072@sha256:9cc5842e99d10a499c3caa256fff2b567d45ab23e9abf8f537df67dca36e7e19",
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
    "3.14-alpine@sha256:5a824eb82cc75361f98611f3cfc5091ea33f10a6ccea4d4ebdabbc523b9a1614",
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
  "kubernetes/kubernetes": "v1.36.1",
  // renovate: datasource=custom.papermc versioning=semver
  paper: "26.1.2",
  // renovate: datasource=docker registryUrl=https://ghcr.io/recyclarr versioning=docker
  recyclarr:
    "8.6.0@sha256:3c38ceeb54438dd8327e4e65c9b48ba601a6d20fff833342d93c9b0bc4b1930b",
  // renovate: datasource=github-releases versioning=semver
  "siderolabs/talos": "1.13.3",
  // renovate: datasource=helm registryUrl=https://opensource.zalando.com/postgres-operator/charts/postgres-operator versioning=semver
  "postgres-operator": "1.15.1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "cooperspencer/gickup":
    "0.10.43@sha256:ad81910605280b2f0fc7495d732c594052790810582fc1a2fa1b2a9704096f52",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "esanchezm/prometheus-qbittorrent-exporter":
    "v1.6.0@sha256:b987d19693a5b2fe7314b22009c6302e084ec801fcf96afaf14065b4cdafc842",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "jsclayton/prometheus-plex-exporter":
    "main@sha256:18ef1b2197efbcb75bd7276380955760995f10a9fbe55106809a6fcff91c2940",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  redis: "25.5.3",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.23.0",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "25.1.2",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "postalserver/postal":
    "3.3.6@sha256:55fa8fcc8b1e40dd07e5ba9d1c421ab7e5b4b4d5675371584dd7699a131e1c59",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "library/mariadb":
    "11.8@sha256:78185355dd49b54dd6909072531ce8d7e06aa0eccd7aa5b23c93ebb7e34c5aaa",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "boky/postfix":
    "latest@sha256:aafc772384232497bed875e1eb66b4d3e54ba1ebc86e2e185a6dc1dbc48182ef",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/busybox":
    "latest@sha256:fd8d9aa63ba2f0982b5304e1ee8d3b90a210bc1ffb5314d980eb6962f1a9715d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/alpine":
    "latest@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "mccloud/bazarr-openai-whisperbridge":
    "latest@sha256:e6d60d008e70c3f6daaa39225db480d698c9be2c57c5857c53caae9798b1f232",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/debian":
    "bookworm-slim@sha256:0104b334637a5f19aa9c983a91b54c89887c0984081f2068983107a6f6c21eeb",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "plausible/analytics":
    "v2.0.0@sha256:cd5f75e1399073669b13b4151cc603332a825324d0b8f13dfc9de9112a3c68a1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "clickhouse/clickhouse-server":
    "26.4-alpine@sha256:128168041226ef603588377b42e07ab4afd7d8f87f59ea46558a69655ff5ad4b",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "tbxark/mcp-proxy":
    "v0.43.2@sha256:1c43164a910a4f74a3ce48d95cb2ef792de8d467296555e63944fa798f0a44bd",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bugsink/bugsink":
    "2.1.3@sha256:cf9ad368d436f0e9dd6e686d0becf5062cc079518efbf032a084c5f73fcf7754",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "2.0.0-3072@sha256:267cd2b772c251d7ace3851fa10ef67531c02a6120d0ba19a9ba5db6fff36020",
  // Custom tasknotes-server image - TaskNotes API server for mobile app
  // not managed by renovate
  "shepherdjerred/tasknotes-server":
    "2.0.0-3072@sha256:71a7e6dfe0a4d258739083f22f54e0048516ca8566ec961e9eef651394bf2072",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-3072@sha256:03769eab0d2437e7e163d35a14fc62f967ea3039e0f8b617e8c0ab1ce379a240",
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
    "2.0.0-3072@sha256:5aebe32e1a22d54fc8ebbaf7bcaf3da132b48941596b0d877daf749f37655c91",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/trmnl-dashboard":
    "2.0.0-3072@sha256:ed7bd66fcbe33839a878843fdfa3d351e6f65cd26532c4ff1a3567b70cdce791",
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
