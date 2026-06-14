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
  // not managed by renovate — built from packages/streambot; CI's version commit-back fills the
  // real tag@digest after the first image push. Seed digest is a placeholder until then.
  "shepherdjerred/streambot":
    "2.0.0-3993@sha256:05ddd3826878e253d9332c17b49f32407b63985371ce86d396a8e4da672b08b5",
  // not managed by renovate — built from upstream redlib's glibc Dockerfile.ubuntu
  // at REDLIB_SOURCE_REF (.dagger/src/constants.ts). The published image is
  // musl/Alpine, which Reddit blocks during OAuth (redlib-org/redlib#551 —
  // "Failed to create OAuth client: 401 Unauthorized"); the glibc build works.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/redlib":
    "2.0.0-3993@sha256:22a6893b5ff7a6c29a6a486cda8434cbdd6fc2888f720ff007096bcb8f4c2906",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.6.0-java21@sha256:496ee192e5f680e8c20bc51da90160fb294d37db98319fad3ecb82e852766e08",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.1.10611-1e34174b1-amd64@sha256:7fe30c0ca399103535e6a5b10207aa2b72d053c652763ee2ce69d082db797d74",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.1@sha256:8e1a0d8104422f646c3e89d9b261b0507dc664bd6764baaea0ff0a5718f83b94",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.5.6@sha256:4b5e510042bf471c8bafab89cada9774fba2fb25f16ec64235151cacbe847c10",
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
    "2.3.5@sha256:2489c6dbaf11e3a6d71aeb2e6980d04193d4af611aa7064a974851222fd41722",
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
    "6.1.1@sha256:c0a4335d4249b46102f64cf6fa27ffc3bddfd9138fac1e4ddf238afd37f02d1f",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.17@sha256:02bc962946fef994e67a38152446df25c10a52f8583aefeeb6467f9dd44cab99",
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
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "koush/scrypted":
    "v0.144.1-noble-full@sha256:25440767192b0d4a0709f50388d14cdf365ba6bff59d04e40a41ca2b7b9a6b70",
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
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  pyroscope: "2.0.3",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  alloy: "1.10.0",
  // renovate: datasource=helm registryUrl=https://openebs.github.io/openebs versioning=semver
  openebs: "4.4.0",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/scout-for-lol/beta":
    "2.0.0-3993@sha256:3161f500f4983e8e18ca9e42bd70453d810331d4c503af7764e5adedd1338091",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-2985@sha256:8b66f27b0daaff642a2ac838e838e8f8ccd64a21e2f9e09fb69730c1bbf8ff36",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-3993@sha256:862fac7d5d46642ef3ba74a1ffcbc7bfbc8b8e20d391c7418c4e97ad2782ddca",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-2970@sha256:89b85d616852f61f17a5201378d0adb812b68d1255ddbe221a6f31670b9c36c2",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-3993@sha256:73f0915a10c0c5b243838651145b8cd70f726d4cbbab7d9e3064741bf991dc9a",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-3993@sha256:60b86019f5c3560eba66db2949fbf084e4654f9df8b4ead923994af8e29f62fc",
  // not managed by renovate — placeholder digest; CI version-commit-back fills
  // the real digest after the first successful image push.
  "shepherdjerred/discord-plays-mario-kart":
    "2.0.0-3993@sha256:9b87702c8cf1786c1330085bc826ae9ba5a2244bb881a7120dacfae82395748e",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.29.0@sha256:cca8988d05cd449e1c6c69405971b1e6fc2c2116ceeb45c9fa3fc33837997a75",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "pinchtab/pinchtab":
    "0.13.2@sha256:9cf0d94352f3e322e9897e61030b5bb90693334f8e5aa1b25a572d892fb3b13c",
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
  "kubernetes/kubernetes": "v1.36.2",
  // renovate: datasource=custom.papermc versioning=semver
  paper: "26.1.2",
  // renovate: datasource=docker registryUrl=https://ghcr.io/recyclarr versioning=docker
  recyclarr:
    "8.6.0@sha256:3c38ceeb54438dd8327e4e65c9b48ba601a6d20fff833342d93c9b0bc4b1930b",
  // renovate: datasource=github-releases versioning=semver
  "siderolabs/talos": "1.13.4",
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
    "11.8@sha256:be1ef4fe5f14589325c08a41c76334097ce66c86264b75e1d28342c742782a61",
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
    "latest@sha256:56ddcb1b34c7ccd0779c2552123f44a69e4785c80c28ed0445e2703d933dfae6",
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
  // mcp-gateway downstream MCP servers (npx-launched in the mcp-proxy container).
  // Pinned + Renovate-tracked so cold starts are reproducible instead of `npx -y`
  // grabbing latest. Substituted into mcp-gateway/config.json at synth time.
  // renovate: datasource=npm versioning=npm
  "@r-huijts/canvas-mcp": "1.0.8",
  // renovate: datasource=npm versioning=npm
  "@modelcontextprotocol/server-github": "2025.4.8",
  // renovate: datasource=npm versioning=npm
  "@automatearmy/email-reader-mcp": "1.0.3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bugsink/bugsink":
    "2.1.3@sha256:cf9ad368d436f0e9dd6e686d0becf5062cc079518efbf032a084c5f73fcf7754",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "2.0.0-3993@sha256:a9a83a80175d2704690856d270ef0c91dfea3aafc162c3914f3e9d93586acef7",
  // Custom tasknotes-server image - TaskNotes API server for mobile app
  // not managed by renovate
  "shepherdjerred/tasknotes-server":
    "2.0.0-3993@sha256:84a5e274b322f2cd9d97e7bf5f2aed1b67e15880fa9ac765358e3ed42526452d",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-3993@sha256:a7caaabdb9a1b8fcf2a634df9440f7ae89ce8a64ce81be8a2b0263c5ae1abded",
  // Custom mcp-gateway image - tbxark/mcp-proxy + prebuilt edstem-mcp (rob-9/edstem-mcp)
  // not managed by renovate
  "shepherdjerred/mcp-gateway":
    "2.0.0-3993@sha256:dfa547084ddc763121fae9954563f7a1d906288bfbf633bbe08b628bdf85166b",
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
    "2.0.0-3993@sha256:ec0a47ab899db4fed3d4207ce6f2264d54d267ee8b6c13725e0125e592c8f96c",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/trmnl-dashboard":
    "2.0.0-3993@sha256:1ea1ab32afb04afbf0899923726a3f0db78ddece61fa7d4d82e8860c958fc030",
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
