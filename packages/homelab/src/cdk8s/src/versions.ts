const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "10.1.3",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.21.0",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.36.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.18.3",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "87.12.2",
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
    "2.0.0-5930@sha256:1edbe999a95bf8b27ebb3bf7bd31917ffc7597ad0c51561828c6cb39c0724204",
  // not managed by renovate — built from upstream redlib's glibc Dockerfile.ubuntu
  // at REDLIB_SOURCE_REF (pinned in the since-removed CI pipeline). The published image is
  // musl/Alpine, which Reddit blocks during OAuth (redlib-org/redlib#551 —
  // "Failed to create OAuth client: 401 Unauthorized"); the glibc build works.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/redlib":
    "2.0.0-5690@sha256:ab53746786cbac48f2376dfcb931b22ea8039867b24b5219fd73aa600fbee2a0",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.7.0-java21@sha256:2619ad4eabfdd6da889c43cba203b87d63a8a9e8f51c8484be371c6f607c1426",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.2.10687-563d026ea-amd64@sha256:c793be6b1ac8b5f25904562a1f341c422f0847228e5f437c0000c0b9748891df",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.2@sha256:2d31250c00737c3cd471b73d8e57c9a19ca37a53faf111b79ce1ee61cc027dc6",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.6.0@sha256:5d916d07404296ec35ee726e13e0e558f05952724cf494a7f009d913fb2b12f3",
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
    "2.4.0@sha256:536036aeb2c740d1a660ccf143b58a8bd6222f09010258fdfc10a538af7bec78",
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
    "6.2.1@sha256:28852d0eacababc206762af48fe86d78594a4f434cc46b358f9764a857098662",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.19@sha256:4b025354d338999e03bf6dbdadcdde94815d39d4a5aba5de3cdc86a56d7d6c51",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:37c99677e997710c1bbe9d74c93f2e3b8de3457a5ca6e28643e251b38ed05311",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.6.0@sha256:ba461b8aa9c042156dbd39c38657fe7431bafa063220eab8d5330a523863da9f",
  // not managed by renovate
  "shepherdjerred/golink":
    "main@sha256:3a204341938acc2cf78da4311487875e604643320a4143d6fd0dfd3eb6102822",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "home-assistant/home-assistant":
    "2026.7.2@sha256:1476924357b46e80735c13e94232ba5c853cac052e9df4bb28d50fa56348097b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bropat/eufy-security-ws":
    "3.1.0@sha256:d41169205f4e20e1e7e173283aaf8bb2d68e2abecb42bc1500a5fac5bb7a8750",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "zwavejs/zwave-js-ui":
    "11.21.1@sha256:1193b96b31488e5a6c7895f16a27b2ead38f8a0c3d1bec335bb10b6d9f9e2905",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "koush/scrypted":
    "v0.144.1-noble-full@sha256:25440767192b0d4a0709f50388d14cdf365ba6bff59d04e40a41ca2b7b9a6b70",
  // renovate: datasource=github-releases versioning=semver
  "fuatakgun/eufy_security": "v8.2.4",
  // renovate: datasource=github-releases versioning=semver
  "basnijholt/adaptive-lighting": "v1.31.0",
  // renovate: datasource=github-releases versioning=semver
  "JeffSteinbok/hass-dreo": "v1.10.1",
  // renovate: datasource=github-releases versioning=semver
  "magico13/ha-emporia-vue": "v0.12.2",
  // renovate: datasource=github-releases versioning=semver
  "dlarrick/hass-kumo": "v0.4.6",
  // renovate: datasource=github-releases versioning=semver
  "kgelinas/Mysa_HA": "v0.9.2",
  // renovate: datasource=github-releases versioning=semver
  "jjjonesjr33/petlibro": "v1.2.32",
  // renovate: datasource=github-releases versioning=semver
  "AlexxIT/SonoffLAN": "v3.12.2",
  // renovate: datasource=github-releases versioning=semver
  "elax46/custom-brand-icons": "2026.07.0",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/syncthing":
    "2.1.2@sha256:e8cc12a9d538d6896942bb3055be9c5bf1cf44c713dfa617b5d3e72037de00fb",
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
    "2.0.0-5930@sha256:bb9e9991f6874c5f96b8e0f2c283acb1359efb435774d89572c7ed63daae4e3d",
  // not managed by renovate — promoted with scripts/promote-scout.ts, in
  // lockstep with scout-for-lol-site/prod (a Renovate bump here would move the
  // prod backend without the matching site content and reintroduce tRPC
  // contract skew).
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-5930@sha256:bb9e9991f6874c5f96b8e0f2c283acb1359efb435774d89572c7ed63daae4e3d",
  // not managed by renovate — promoted with scripts/promote-scout.ts, in
  // lockstep with shepherdjerred/scout-for-lol/prod. Version of the archived
  // site artifact (scout-site-releases bucket) the prod bucket is synced from
  // by the scout-prod-reconcile CI step. "unpromoted" = pre-first-promotion
  // sentinel: reconcile logs and exits without touching the prod bucket.
  "scout-for-lol-site/prod": "2.0.0-5941",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-5930@sha256:b5c05ff67549e1aca172328e00078538272c7a7e0babdb71b681fd7e856f943d",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-4777@sha256:6a94f1d598bef983189c3f0b74d24f1c2c94ea4ba260dc2a5203d2d4bd735402",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-5930@sha256:af0b572d131570e0953403364a81b10dcb3ec93e7a29527cde44ac72550c26df",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-5930@sha256:d49aca883be2aacb51fc7df1c8e1acb664bc33fff398f5204471f14b20ebbf67",
  // not managed by renovate — placeholder digest; CI version-commit-back fills
  // the real digest after the first successful image push.
  "shepherdjerred/discord-plays-mario-kart":
    "2.0.0-5930@sha256:b4f28ed77541b2bec94fe14d2e3e269a59e9cf57d0c6823a29b1f0591dbc2c0e",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.29.1@sha256:ab6b363102ccdbc39f6a62db926f567c61a5289bf25ba460f1c34423d8cc1a4d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "pinchtab/pinchtab":
    "0.14.1@sha256:def590d867e74fdeccbe97eab23704b1f5ad592148976d3df6a104fe0d6f7cc3",
  // renovate: datasource=docker registryUrl=https://ghcr.io/buildkite/helm versioning=semver packageName=agent-stack-k8s
  "agent-stack-k8s":
    "0.45.0@sha256:82920b774ff106d40ab961c23ed623fd253780c68f6311d0152b73d1033708f3",
  // Self-hosted Turborepo remote cache (backs the workspace task-graph
  // replatform — packages/docs/plans/2026-07-12_workspace-taskgraph-replatform.md).
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "ducktors/turborepo-remote-cache":
    "2.11.2@sha256:99634a04eba43c839fb96f3e60bf0012b59abe1e6889153580493a840aad7ad0",
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
  velero: "12.1.0",
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
  "siderolabs/talos": "1.13.6",
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
  redis: "27.0.14",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.33.0",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "26.1.8",
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
    "2.2.2@sha256:bc9915a8ce8e723684948eb43cda92239b1cb8602e537baf90265a260f2e0376",
  // Relay Server - self-hosted Obsidian real-time collaboration backend (y-sweet fork)
  // not managed by renovate (docker.system3.md is a private relay.md registry; bump manually on upgrade)
  "relay-server":
    "v0.9.2@sha256:815222bd2dc167ee0a5b702d2dcd3d9eb681985b9eb5e6e761adf3933554a11f",
  // Custom caddy-s3proxy image - Caddy with s3proxy plugin for serving static sites from S3
  // not managed by renovate
  "shepherdjerred/caddy-s3proxy":
    "2.0.0-5690@sha256:57ac1e5b9a9106d006f66015f80da7c1835214687e3cd968f457cc820335438c",
  // Custom tasknotes-server image - TaskNotes API server for mobile app
  // not managed by renovate
  "shepherdjerred/tasknotes-server":
    "2.0.0-5930@sha256:e6b631acf831ff674936de90c3918c6c27ba916f3955107d9d6665d4a719c5cd",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-5690@sha256:a8f87a8aed271c4eda202b224ebe23e38f8c7161951d1968f27feeecdb56acab",
  // Custom mcp-gateway image - tbxark/mcp-proxy + prebuilt edstem-mcp (rob-9/edstem-mcp)
  // not managed by renovate
  "shepherdjerred/mcp-gateway":
    "2.0.0-5690@sha256:df47be0245e7f84e58c1ae1f7184718d2b7e12498a64e4488de65e6be27dacfa",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/auto-setup":
    "1.29.7@sha256:f14912b699cf73015ad5c4fc18d522d4b014db90e794039214dfb7c022c2644f",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/ui":
    "2.52.0@sha256:fc47cd8202c98ed868745fd9f2f011585232676d08da621b9a6d7bc4653c17aa",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/admin-tools":
    "1.31.2@sha256:dbc5fcd6ee8f0f4d808bf765af9a87dea9d8a283abfdcfbd2fc148496ba66107",
  // Custom temporal-worker image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/temporal-worker":
    "2.0.0-5930@sha256:6267ebe6795f34794377048b9e2c78d1302998af7798ba5618d8039eb5d9632f",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/trmnl-dashboard":
    "2.0.0-5930@sha256:088cf081266460e933556938fce9876bf726dfc4a60273371ea9b258ef262671",
};

/**
 * SHA-256 of the GitHub release tarball for `fuatakgun/eufy_security`, pinned
 * to the version above. Verified at install time by the Home Assistant init
 * container so a tampered or silently-reuploaded tag can't ship custom code
 * onto the config PVC. Verified BEFORE the two checked-in patches under
 * `patches/eufy_security/` are applied (see ha-custom-components.ts) — this
 * hash is of the pristine upstream tarball, not the patched result.
 *
 * Enforced by `ha-custom-component-integrity.test.ts` (CI-only): any Renovate
 * PR that bumps `fuatakgun/eufy_security` without updating this hash will
 * fail CI, and the same test also re-verifies both patches still apply
 * cleanly against the (possibly newer) pristine source.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["fuatakgun/eufy_security"])')
 *   curl -fSL "https://github.com/fuatakgun/eufy_security/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const EUFY_TARBALL_SHA256 =
  "b744aac0ce03a8a75de5100c672957504173c20cbe2ac0fc4d09d5bc75c59411";

/**
 * SHA-256 of the GitHub release tarball for `basnijholt/adaptive-lighting`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["basnijholt/adaptive-lighting"])')
 *   curl -fSL "https://github.com/basnijholt/adaptive-lighting/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const ADAPTIVE_LIGHTING_TARBALL_SHA256 =
  "9c390346e022651778aaed613946a5275a503966274dfa399b966e0eb90f7ca4";

/**
 * SHA-256 of the GitHub release tarball for `JeffSteinbok/hass-dreo`, pinned
 * to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["JeffSteinbok/hass-dreo"])')
 *   curl -fSL "https://github.com/JeffSteinbok/hass-dreo/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const DREO_TARBALL_SHA256 =
  "330a8563f7a995517f3a8b4a33816b282e5a3b539d98678091795b997fbee341";

/**
 * SHA-256 of the GitHub release tarball for `magico13/ha-emporia-vue`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["magico13/ha-emporia-vue"])')
 *   curl -fSL "https://github.com/magico13/ha-emporia-vue/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const EMPORIA_VUE_TARBALL_SHA256 =
  "29595c369bedcf86577aedc73398325120be1b6bdcd154a61e75c3bda77d2d2d";

/**
 * SHA-256 of the GitHub release tarball for `dlarrick/hass-kumo`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["dlarrick/hass-kumo"])')
 *   curl -fSL "https://github.com/dlarrick/hass-kumo/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const KUMO_TARBALL_SHA256 =
  "34b88547e0809b7849ba1fc1a3f149777a1a44a1d97bc56fed734224fdfbef0b";

/**
 * SHA-256 of the GitHub release tarball for `kgelinas/Mysa_HA` (true
 * upstream, not the retired `shepherdjerred/Mysa_HA` fork), pinned to the
 * version above. Verified BEFORE the checked-in patch under
 * `patches/mysa/` is applied — this hash is of the pristine upstream
 * tarball, not the patched result. See EUFY_TARBALL_SHA256 for why this
 * exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["kgelinas/Mysa_HA"])')
 *   curl -fSL "https://github.com/kgelinas/Mysa_HA/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const MYSA_TARBALL_SHA256 =
  "9d8120570bec8f1befedac4b20d67d1fb726da8fdf249305e21fae0213d1a0d9";

/**
 * SHA-256 of the GitHub release tarball for `jjjonesjr33/petlibro`, pinned
 * to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["jjjonesjr33/petlibro"])')
 *   curl -fSL "https://github.com/jjjonesjr33/petlibro/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const PETLIBRO_TARBALL_SHA256 =
  "42203f0fc8ea7a9fa80877633b36ed0cfd4ef4f86f904a994d35b121e44c607f";

/**
 * SHA-256 of the GitHub release tarball for `AlexxIT/SonoffLAN`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["AlexxIT/SonoffLAN"])')
 *   curl -fSL "https://github.com/AlexxIT/SonoffLAN/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const SONOFF_TARBALL_SHA256 =
  "ce8fde8033260a191f498f71e37ac91ccef83f2388c1552d0d671c1fa718d0dc";

/**
 * SHA-256 of the GitHub release tarball for `elax46/custom-brand-icons`
 * (a frontend plugin, not an integration — see ha-custom-components.ts for
 * its different install shape), pinned to the version above. See
 * EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["elax46/custom-brand-icons"])')
 *   curl -fSL "https://github.com/elax46/custom-brand-icons/archive/refs/tags/$VERSION.tar.gz" | sha256sum
 */
export const CUSTOM_BRAND_ICONS_TARBALL_SHA256 =
  "3f1d70118cb1fa4d4ebbccaedf8c168a8a7e34ea1cfed5c18b01e7fb1c01d6de";

export default versions;
