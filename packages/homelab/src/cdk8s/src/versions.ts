const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "9.5.15",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.20.2",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.35.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.18.3",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "85.2.2",
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
    "2.0.0-4645@sha256:498a9da2516d7ebb8141499c30c21f66743d6ae66d06d5e0e0a63aa125f6db77",
  // not managed by renovate — built from upstream redlib's glibc Dockerfile.ubuntu
  // at REDLIB_SOURCE_REF (.dagger/src/constants.ts). The published image is
  // musl/Alpine, which Reddit blocks during OAuth (redlib-org/redlib#551 —
  // "Failed to create OAuth client: 401 Unauthorized"); the glibc build works.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/redlib":
    "2.0.0-4665@sha256:d3ea7ad4807ed29fcc4b423ab6c35076b21653ef6801971ba358255c10863b9c",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.6.0-java21@sha256:496ee192e5f680e8c20bc51da90160fb294d37db98319fad3ecb82e852766e08",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.2.10687-563d026ea-amd64@sha256:c793be6b1ac8b5f25904562a1f341c422f0847228e5f437c0000c0b9748891df",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.1@sha256:f13b3e7d6798e62eef6f9a9e65513d2e0a8f468524432c2d753b7b458b1876d4",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.5.6@sha256:8e48a2950e3806a2a914fe031fa21b1c0a0f2824eede4ea747e26213e941fbf2",
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
    "2.0.0-4665@sha256:30a4375f3e6d4807783c4287b8ea9db31ccb9ba745d7f5c7d44a2ac13897c2e9",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-4653@sha256:fe82c9bab75d1ede15042ab0bcc6bc2bd25bbd761e265e5c825371b86243a03e",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-4645@sha256:eef6269a3e0e5451029b45625dcb1f8e1fc8c2fff73f7bfef92371aadfed96ee",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-4334@sha256:9b92dead16a9bf07e795f3b70c6b3caf80a156c408eb4701d15660998c771f65",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-4645@sha256:38ad3b67447b1431d4caf6da6d90cae80444474c2081a098e92be640db33f76a",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-4645@sha256:40fc67f45c5994259274ce237b0c6273f9cad03a705bbab628fd14c94e4bf92a",
  // not managed by renovate — placeholder digest; CI version-commit-back fills
  // the real digest after the first successful image push.
  "shepherdjerred/discord-plays-mario-kart":
    "2.0.0-4645@sha256:8874ef0d0bd62c763aecfc53d6d7abdd494c7c5678a671fdfd69d43629e80d52",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.29.1@sha256:ab6b363102ccdbc39f6a62db926f567c61a5289bf25ba460f1c34423d8cc1a4d",
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
    "3.14-alpine@sha256:26730869004e2b9c4b9ad09cab8625e81d256d1ce97e72df5520e806b1709f92",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bitnamilegacy/kubectl":
    "1.33.4@sha256:ed0b31a0508da84ee655c5c6e01bd3897fc56ad6cf69debb27fa1893a06d2246",
  // renovate: datasource=helm registryUrl=https://vmware-tanzu.github.io/helm-charts versioning=semver
  velero: "12.0.1",
  // renovate: datasource=helm registryUrl=https://kyverno.github.io/kyverno versioning=semver
  kyverno: "3.8.1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "velero/velero-plugin-for-aws":
    "v1.14.1@sha256:1493a0039cd5cb31004cfbb52f8a1990bc0ed81497ce72516bc76fa9e21506c1",
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
  seaweedfs: "4.28.0",
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
    "latest@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "mccloud/bazarr-openai-whisperbridge":
    "latest@sha256:10212b643245b97d0369d1be3448cc35e61f7df78b4861cf7df90608e9c803d3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/debian":
    "bookworm-slim@sha256:96e378d7e6531ac9a15ad505478fcc2e69f371b10f5cdf87857c4b8188404716",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "plausible/analytics":
    "v2.0.0@sha256:cd5f75e1399073669b13b4151cc603332a825324d0b8f13dfc9de9112a3c68a1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "clickhouse/clickhouse-server":
    "26.5-alpine@sha256:a4202d2f7a0c0ac98aca2bda670f5b7278722463c0bdd4c2de5241e8e1e898ed",
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
    "2.2.0@sha256:aa96181b44f8a97a38db0c6530583cd81ecbe546d9d63dd4c19570adbc1a0e7a",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "2.0.0-4665@sha256:ffb5f3e3cf1b5ffb6fc2f34a6afe8ac0d2c6172c5ab1faafd66596fe41847d5f",
  // Custom tasknotes-server image - TaskNotes API server for mobile app
  // not managed by renovate
  "shepherdjerred/tasknotes-server":
    "2.0.0-4645@sha256:3206b252528c7a65012471148c4f758f8e247664ec8202f6bd3503617837ab05",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-4665@sha256:7d2cee4c6cf737d6a5c37ec1c88e70f575d34c18e9a0ef7eb71c854c1d2f8e1e",
  // Custom mcp-gateway image - tbxark/mcp-proxy + prebuilt edstem-mcp (rob-9/edstem-mcp)
  // not managed by renovate
  "shepherdjerred/mcp-gateway":
    "2.0.0-4665@sha256:40c8a576b2121348bb8ba1af88c79d5efdc687be30702429a9db30ada5380bec",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/auto-setup":
    "1.29.6@sha256:1263120feed69d82e4ca23b8ca6f1d702c3029fe70714e382966d0192318eab6",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/ui":
    "2.50.0@sha256:49a61456f6b770af926d6d7d74f63ebb4b9a3c5abc4fb68ddb146321d49391e4",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/admin-tools":
    "1.31.0@sha256:3e68adcd54195a7c1222e99f2dbc32a4fdbf44ad69e3bb48e21e85c4bf417c2e",
  // Custom temporal-worker image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/temporal-worker":
    "2.0.0-4670@sha256:ad4e399362b65479483ce47234c7711185f83396563f1b9cf8462b46fec64f1d",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/trmnl-dashboard":
    "2.0.0-4645@sha256:fc936171744e23d8e4b3128cbfae97df838486799cd7fb3a462a287f9ba34976",
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
