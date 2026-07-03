const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "10.1.1",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.20.3",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.36.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.18.3",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "87.6.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-adapter": "5.3.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-blackbox-exporter": "11.15.1",
  // renovate: datasource=helm registryUrl=https://pkgs.tailscale.com/helmcharts versioning=semver
  "tailscale-operator": "1.98.4",
  // renovate: datasource=github-releases versioning=semver
  "adyanth/cloudflare-operator": "v0.13.1",
  // not managed by renovate — built from packages/streambot; CI's version commit-back fills the
  // real tag@digest after the first image push. Seed digest is a placeholder until then.
  "shepherdjerred/streambot":
    "2.0.0-4789@sha256:5e1b80bb46c1ffedbd63dd42463a05d5b71a957b6b19fbed53b99dd57d9ed06e",
  // not managed by renovate — built from upstream redlib's glibc Dockerfile.ubuntu
  // at REDLIB_SOURCE_REF (.dagger/src/constants.ts). The published image is
  // musl/Alpine, which Reddit blocks during OAuth (redlib-org/redlib#551 —
  // "Failed to create OAuth client: 401 Unauthorized"); the glibc build works.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/redlib":
    "2.0.0-4794@sha256:dc7a02a3d9253d87f7227bb4ec9dc1129825f6db6ab849c7c3d4a9d41c2cfec3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.6.1-java21@sha256:968e3cd018fe2c86537c515ce07ac364beb1a466a628b149277da5c144dad592",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.2.10687-563d026ea-amd64@sha256:c793be6b1ac8b5f25904562a1f341c422f0847228e5f437c0000c0b9748891df",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.2@sha256:fb1a686e4b676af3bd8f6e1a5a0097ee1540015768e9bbd4445e130d703a68cd",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.5.6@sha256:047222423d6d8556a88581b189175bec57f286f120b52ba29c0390fe6babaa5a",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  // Kept alongside Seerr during the migration; remove once Seerr fully owns the request flow.
  "linuxserver/overseerr":
    "1.35.0@sha256:6108ed066d4a919c05251d9dab041c1e55e67ff7247e7b31be97b65ffcbaeeb1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "seerr-team/seerr":
    "v3.3.0@sha256:c92d2dc117f62185e7bcb88cd56efd374ea79210eaf433275449e8d5988eb5a8",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "jellyfin/jellyfin":
    "10.11.11@sha256:45f648c382a0c8b552582fcea40e95cb17c5d475473a891cba0eb7523fb92112",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "kometateam/kometa":
    "v2.4.4@sha256:90e53a6bdf9343d63702767f8f6d6da09902e7bd174850120ac50d39a0722ff1",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/prowlarr":
    "2.4.0@sha256:3e9bd62ca90c97c5df75b7012e10a29f6926e62807deeddc1dc89e6e2fd141e1",
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
    "6.2.1@sha256:39da107b5a9371fdaa651bd188049b863716a815385eb3a30d41071b7e1aeb33",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.19@sha256:fbb15bb4fb14d1ffe017f6be0e3fed8f1b300e4687e329767da0b61f36ba1eed",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:37c99677e997710c1bbe9d74c93f2e3b8de3457a5ca6e28643e251b38ed05311",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.5.2@sha256:12ff5c6992a9863db4da270746af7c244bcaee49353039af8104268a18d6c4f0",
  // not managed by renovate
  "shepherdjerred/golink":
    "main@sha256:3a204341938acc2cf78da4311487875e604643320a4143d6fd0dfd3eb6102822",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "home-assistant/home-assistant":
    "2026.7.0@sha256:cb76c9922b530f6a5063a15463eb3ad6de287d297c826713abda16795bb98980",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bropat/eufy-security-ws":
    "3.1.0@sha256:d41169205f4e20e1e7e173283aaf8bb2d68e2abecb42bc1500a5fac5bb7a8750",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "zwavejs/zwave-js-ui":
    "11.19.1@sha256:944d39fe22d8985ddcbef0849cd22984b8340448f742195821cc34f7a9ca1bb4",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "koush/scrypted":
    "v0.144.1-noble-full@sha256:25440767192b0d4a0709f50388d14cdf365ba6bff59d04e40a41ca2b7b9a6b70",
  // renovate: datasource=github-releases versioning=semver
  "fuatakgun/eufy_security": "v8.2.4",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/syncthing":
    "2.1.1@sha256:56fc719962de84a2bb1033d6925c2796e62e6d59b6504698528dd08d2d5cbe15",
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
  pyroscope: "2.1.0",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  alloy: "1.10.0",
  // renovate: datasource=helm registryUrl=https://openebs.github.io/openebs versioning=semver
  openebs: "4.5.1",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/scout-for-lol/beta":
    "2.0.0-4789@sha256:a9a37ac0a0b5d02f111d56715fea4b1811d302f64a1504d940d9662a3d7fc27b",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-4791@sha256:bfd87a5cebfa8567cf14d077cd58bcf84f6315d04ea962468695e1fc99bf58e6",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-4775@sha256:b83b980cc44f22cc430cd4da2e43bd2cdef760ea279f318775c457e33deca610",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-4777@sha256:6a94f1d598bef983189c3f0b74d24f1c2c94ea4ba260dc2a5203d2d4bd735402",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-4775@sha256:dcb34d766a1d2c6f180206e3bf65917b1f888a39b16fc9dd34a7b557a242205b",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-4789@sha256:6926e940413ff9c6cd45fe3f5b3e6aa46554cf34acc5c5dc64aa5c92988bfab9",
  // not managed by renovate — placeholder digest; CI version-commit-back fills
  // the real digest after the first successful image push.
  "shepherdjerred/discord-plays-mario-kart":
    "2.0.0-4789@sha256:1d1bf655507a692b2e7dbbbd0bf5b6d37d7ce6585286c0a419ac70a93fe70a94",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.29.1@sha256:ab6b363102ccdbc39f6a62db926f567c61a5289bf25ba460f1c34423d8cc1a4d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "pinchtab/pinchtab":
    "0.14.0@sha256:2e8ba8662b71cfde2df4f6ff23a98ad90e80857dd1c12466ae37cce542449669",
  // renovate: datasource=docker registryUrl=https://ghcr.io/buildkite/helm versioning=semver packageName=agent-stack-k8s
  "agent-stack-k8s":
    "0.44.0@sha256:e9b96d3c3bdd4928115fbd844774e81371c72b95f316da4252b716203c292044",
  // renovate: datasource=docker registryUrl=https://registry.dagger.io versioning=semver packageName=dagger-helm
  "dagger-helm": "0.20.8",
  // renovate: datasource=docker registryUrl=https://registry.k8s.io versioning=semver packageName=kueue/charts/kueue
  kueue:
    "0.18.2@sha256:156fbc8c6752b08cf66a2324fed33e269e0a64e54dd8d70d51118065bca651af",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/python":
    "3.14-alpine@sha256:26730869004e2b9c4b9ad09cab8625e81d256d1ce97e72df5520e806b1709f92",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bitnamilegacy/kubectl":
    "1.33.4@sha256:ed0b31a0508da84ee655c5c6e01bd3897fc56ad6cf69debb27fa1893a06d2246",
  // renovate: datasource=helm registryUrl=https://vmware-tanzu.github.io/helm-charts versioning=semver
  velero: "12.0.2",
  // renovate: datasource=helm registryUrl=https://kyverno.github.io/kyverno versioning=semver
  kyverno: "3.8.1",
  // PINNED to v1.14.0 (last release that works on Cloudflare R2). The plugin always sets an
  // (often empty) `Tagging` field on PutObject; v1.14.1's dependency bump pulled a newer
  // aws-sdk-go-v2 that started emitting an empty `x-amz-tagging` header on the wire, which R2
  // rejects with `501 NotImplemented` ("Header 'x-amz-tagging' with value '' not implemented").
  // That fails Velero's backup-metadata upload, so every backup since the v1.14.1 deploy
  // (2026-06-21, PR #1307) is marked Failed and leaves orphaned ZFS snapshots + R2 data behind
  // (PagerDuty #5860, #5849). v1.14.2 is NOT a fix — it still sets Tagging unconditionally; the
  // upstream guard (velero-io/velero-plugin-for-aws#299) is on main, not in any release yet.
  // Renovate is blocked to <1.14.1 in renovate.json until a release contains #299 and is
  // verified on R2. See packages/docs/todos/velero-aws-plugin-r2-tagging.md.
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
    "0.10.45@sha256:b4a84f04163099d9f41c648e78a8402d8e6dfe1ece07ccdb3d439543aec5f378",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "esanchezm/prometheus-qbittorrent-exporter":
    "v1.7.0@sha256:02dbf86bd2850dcb94e7df5684159b954386e978e20f6b473f92efa62335f552",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "jsclayton/prometheus-plex-exporter":
    "main@sha256:18ef1b2197efbcb75bd7276380955760995f10a9fbe55106809a6fcff91c2940",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  redis: "27.0.13",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.31.0",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "26.1.7",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "postalserver/postal":
    "3.3.7@sha256:e54b4a7eb106ee15eda5664311c4b9415546d4196f5c4336d23a78d6ce57b819",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "library/mariadb":
    "11.8@sha256:efb4959ef2c835cd735dbc388eb9ad6aab0c78dd64febcd51bc17481111890c4",
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
    "bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "plausible/analytics":
    "v2.0.0@sha256:cd5f75e1399073669b13b4151cc603332a825324d0b8f13dfc9de9112a3c68a1",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "clickhouse/clickhouse-server":
    "26.5-alpine@sha256:d6d599097220479d6a55d6dc838b44fdea7774003666860701c82dc178c6ad13",
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
    "2.2.1@sha256:26da3e335f496b8270f4b59defeed414cc2a0b053f9e2ef3486d38bbad6058f9",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "2.0.0-4794@sha256:f4ec3004c861b8cbdb81110b0e0825146c9abf05031e557cf9f871ac491e14cd",
  // Custom tasknotes-server image - TaskNotes API server for mobile app
  // not managed by renovate
  "shepherdjerred/tasknotes-server":
    "2.0.0-4775@sha256:16bfef9b4122d19c33d9d759cc69efab2f70c36d3263d15ad89525523f9951fa",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-4794@sha256:c33a4df1e37650a16da49e30b45129fb1373b6db5e6cc998291fbddd1fe7f587",
  // Custom mcp-gateway image - tbxark/mcp-proxy + prebuilt edstem-mcp (rob-9/edstem-mcp)
  // not managed by renovate
  "shepherdjerred/mcp-gateway":
    "2.0.0-4794@sha256:1fa502ef662b446531ac34238e931094fb1b94af6595c714cf9adfa4aac05508",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/auto-setup":
    "1.29.7@sha256:f14912b699cf73015ad5c4fc18d522d4b014db90e794039214dfb7c022c2644f",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/ui":
    "2.51.1@sha256:6d2fbeba176c9f6f93cd3b352742cd21a25b3e2f467b276aacbb9b5b2bfde00f",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/admin-tools":
    "1.31.1@sha256:0fa94393f6254dea05df1cdacb7a8ee95f6fb51a2ffbde0c6847a73037f788c7",
  // Custom temporal-worker image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/temporal-worker":
    "2.0.0-4794@sha256:f49cf21e36bcd68fd150de4599f2105a47c180015eea1e54bf9dbd38b1eb5394",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/trmnl-dashboard":
    "2.0.0-4775@sha256:d15b0ae5d5c432e1cec3aa29c131eebe972fb2bea07505876d5425f3c70fbdec",
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
