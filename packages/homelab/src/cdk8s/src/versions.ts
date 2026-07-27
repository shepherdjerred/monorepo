const versions = {
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "10.1.4",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.21.0",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.36.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.19.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "87.17.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-adapter": "5.3.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-blackbox-exporter": "11.15.1",
  // renovate: datasource=helm registryUrl=https://pkgs.tailscale.com/helmcharts versioning=semver
  "tailscale-operator": "1.98.9",
  // renovate: datasource=github-releases versioning=semver
  "adyanth/cloudflare-operator": "v0.13.1",
  // not managed by renovate — built from packages/streambot; CI's version commit-back fills the
  // real tag@digest after the first image push. Seed digest is a placeholder until then.
  "shepherdjerred/streambot":
    "2.0.0-6529@sha256:15d55080a91fa8dd501e8c8be6a5cc8009b1264d7dcccd2108c62b9d78432e46",
  // not managed by renovate — built from upstream redlib's glibc Dockerfile.ubuntu
  // at REDLIB_SOURCE_REF (pinned in the since-removed CI pipeline). The published image is
  // musl/Alpine, which Reddit blocks during OAuth (redlib-org/redlib#551 —
  // "Failed to create OAuth client: 401 Unauthorized"); the glibc build works.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/redlib":
    "2.0.0-6529@sha256:3ecba21c949f061927024019ec0c8a34e43ecc56df2bc0c8bcbf94b355564347",
  // not managed by renovate — built from upstream selmant/shelfbridge at
  // SHELFBRIDGE_SOURCE_REF (packages/homelab/images/shelfbridge/Dockerfile);
  // upstream publishes goreleaser binaries only, no container image.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/shelfbridge":
    "2.0.0-5991@sha256:f3b7c4f263566c851462c846f494f38d8e7fb45eaad3a611c300a831e272ec22",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "itzg/minecraft-server":
    "2026.7.0-java21@sha256:2619ad4eabfdd6da889c43cba203b87d63a8a9e8f51c8484be371c6f607c1426",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=loose
  "plexinc/pms-docker":
    "1.43.3.10828-00f62d37d-amd64@sha256:f6748983db1054b571b57b4a40f07f53af6c4bfb9edd1fa455f5ebb6e16449bc",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "linuxserver/tautulli":
    "2.17.2@sha256:ef7f4329e5029f83bc93a6fef9a06e67b97652573ce3d62402645ba0d933a0be",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/bazarr":
    "1.6.0@sha256:ab401a0f361cfad328e444838b13d5b334b189d0f556fc91a3623eb581df36df",
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
    "2.4.0@sha256:4fd7a166c8f46dd3370a871c250ee577d6c2ae97a0dbe0e3614b5ef736205620",
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
    "6.3.0@sha256:e35056574cdc695a9ee745aa1ecda9eab3842450bf4b7b8471b023790fa3861d",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/sonarr":
    "4.0.19@sha256:24acea2956a0ccb11f103877d9f4f8576600fb34bff34820ed749c2256dab89f",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  // Bindery (Readarr replacement) — keep serving upstream until the patched
  // first-party image below has a real digest and its GHCR package is public.
  "vavallee/bindery":
    "v1.26.2@sha256:5d898d2b0d2000465b3c5f15fc0aa918458f017558f48f111b772a59b04a819d",
  // not managed by renovate — publication-stage pin only; no Deployment reads
  // this key yet. Main CI builds upstream vavallee/bindery at BINDERY_SOURCE_REF
  // (packages/homelab/images/bindery/Dockerfile), applies the Chinese Google
  // Books patch, then version commit-back replaces this seed after the first
  // push. Switch the Deployment only after the real digest resolves publicly.
  "shepherdjerred/bindery":
    "2.0.0-6529@sha256:661cde3b4d79fbd43f730b4e0f2832b4e7172bf5fd631f35d32f4c535429a58a",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  // Calibre-Web Automated — library + ingest + Send-to-Kindle path
  "crocodilestick/calibre-web-automated":
    "v4.0.6@sha256:c31a738b6d5ec6982c050063dd3f063b6943eb1051fc81144789f840d9093a8d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:37c99677e997710c1bbe9d74c93f2e3b8de3457a5ca6e28643e251b38ed05311",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.6.1@sha256:6d91c121b803126f7a5344005d17a9324788fc09d305b6e2560ec6040a7ae283",
  // not managed by renovate (upstream tailscale/golink ships a rolling `main` tag)
  "tailscale/golink":
    "main@sha256:dc62e0d38bd2633d3090e6ca1de327471c376afe0457d397c4f111e5a98d8a88",
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
  "JeffSteinbok/hass-dreo": "v1.10.2",
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
    "2.1.2@sha256:ae909bee7c41f516be03fd7de72317a44f4a043bcba76884de941b99407b6957",
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
  loki: "7.1.0",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  promtail: "6.17.1",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  tempo: "1.24.4",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  pyroscope: "2.1.1",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  alloy: "1.10.1",
  // renovate: datasource=helm registryUrl=https://openebs.github.io/openebs versioning=semver
  openebs: "4.5.1",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/scout-for-lol/beta":
    "2.0.0-6529@sha256:513a70ed76aae0e188fe56cca3edf52bbf9ae727a7e2bcc05d8fbac03704e880",
  // Prod promotion = merging the Renovate PR for this pin. Each 2.0.0-<n>
  // tag is minted by the scout-tag-release CI step only after site version
  // <n> is archived, pointing at the backend digest beta serves it against —
  // so every tag Renovate can offer is a complete backend+site pair. The
  // scout-prod-reconcile step derives the prod site version from this pin's
  // tag portion. Only ever pin a minted tag (semver caveat: if the release
  // base moves off 2.0.0-, this pin needs one manual edit).
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-6529@sha256:513a70ed76aae0e188fe56cca3edf52bbf9ae727a7e2bcc05d8fbac03704e880",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-6529@sha256:f264607c7bf8fcca4a1d88bfdf9c36baf32623bed373f9925323fc35369c521c",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-4777@sha256:6a94f1d598bef983189c3f0b74d24f1c2c94ea4ba260dc2a5203d2d4bd735402",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-6529@sha256:f1170d0809f95143a6c11060de651bc2a06fa266d49d3788498ccc031d78e7da",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-6529@sha256:8060b132fb0007cb9e9c3ba0c16601600bfaa1cea24913dec650fe7b6e4f9a88",
  // not managed by renovate — placeholder digest; CI version-commit-back fills
  // the real digest after the first successful image push.
  "shepherdjerred/discord-plays-mario-kart":
    "2.0.0-6529@sha256:2d2dd8d2b4358d8f4cce252ceadf5f45837eed0f379807e1b779deeb5d5fcb29",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.29.1@sha256:ab6b363102ccdbc39f6a62db926f567c61a5289bf25ba460f1c34423d8cc1a4d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "pinchtab/pinchtab":
    "0.15.0@sha256:a4d5ac974eb093adf0211389257179f4f4ca16369f91479be67bd881c376e716",
  // renovate: datasource=docker registryUrl=https://ghcr.io/buildkite/helm versioning=semver packageName=agent-stack-k8s
  "agent-stack-k8s":
    "0.46.0@sha256:ecd95afbb320954c3d186d856f6ed02df22b0d7f88724fe16446ed4c0dd5aa4d",
  // Self-hosted Turborepo remote cache (backs the workspace task-graph
  // replatform — packages/docs/plans/2026-07-12_workspace-taskgraph-replatform.md).
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "ducktors/turborepo-remote-cache":
    "2.11.2@sha256:99634a04eba43c839fb96f3e60bf0012b59abe1e6889153580493a840aad7ad0",
  // Persistent BuildKit daemon backing CI image builds (bounded-GC cache on a
  // compressed ZFS PVC, replacing the per-run throwaway builder inside dind —
  // moves the build-layer write storm off the xfs /var system disk).
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "moby/buildkit":
    "v0.28.1@sha256:a82d1ab899cda51aade6fe818d71e4b58c4079e047a0cf29dbb93b2b0465ea69",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/python":
    "3.14-alpine@sha256:26730869004e2b9c4b9ad09cab8625e81d256d1ce97e72df5520e806b1709f92",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bitnamilegacy/kubectl":
    "1.33.4@sha256:ed0b31a0508da84ee655c5c6e01bd3897fc56ad6cf69debb27fa1893a06d2246",
  // renovate: datasource=helm registryUrl=https://vmware-tanzu.github.io/helm-charts versioning=semver
  velero: "12.1.0",
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
    "8.7.0@sha256:2d6107f758d882a59fe9d646aa54fa8a5a4fb7a40995125fade575652a3f7871",
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
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "resmoio/kubernetes-event-exporter":
    "v1.7@sha256:8abb52b66557d3333f9e473e0eff2951309abfd018bd8d7fcfd86c4ecce6b9cf",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  redis: "27.0.15",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.34.0",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "26.2.0",
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
    "bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818",
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
  "@r-huijts/canvas-mcp": "1.3.0",
  // renovate: datasource=npm versioning=npm
  "@modelcontextprotocol/server-github": "2025.4.8",
  // renovate: datasource=npm versioning=npm
  "@automatearmy/email-reader-mcp": "1.0.3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bugsink/bugsink":
    "2.4.0@sha256:bc3a491edb7d94d42ae49be14f586a4b7eefa929389272c37f9bec112f232e78",
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
    "2.0.0-6529@sha256:8becab44fe5ca4f6ec72ce20c33720b15396c2ad9ab982fa4ac1c1a5a67157b2",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-6529@sha256:fd1e89af7747c0b0ad2c650c6eab0c60452464e83dfcfb3bedbf967f15e7e645",
  // Custom mcp-gateway image - tbxark/mcp-proxy + prebuilt edstem-mcp (rob-9/edstem-mcp)
  // not managed by renovate
  "shepherdjerred/mcp-gateway":
    "2.0.0-6529@sha256:aa5f55114c503a724f529fc817a600ad693516b04d044be6df22c7fbac64ca23",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/auto-setup":
    "1.29.7@sha256:f14912b699cf73015ad5c4fc18d522d4b014db90e794039214dfb7c022c2644f",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/ui":
    "2.52.1@sha256:b839b5c798770896c78058db1647d325a19b3acef7fa1fbd9a23fabb1dd7feb2",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "temporalio/admin-tools":
    "1.31.2@sha256:dbc5fcd6ee8f0f4d808bf765af9a87dea9d8a283abfdcfbd2fc148496ba66107",
  // Custom temporal-worker image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/temporal-worker":
    "2.0.0-6556@sha256:428df66577082dbe1e8a80541e1f556a6580c2e9ec39e29d5c451c38f71e0f2f",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/trmnl-dashboard":
    "2.0.0-6529@sha256:4ff4998a441a4e13c9f3bf06b2817507784bb8d0565d7a34829708e718311c8d",
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
  "15eab378ea2bc76de4af8fc7f10f4beb3882e9f66948a7a7b1de6599d680f076";

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
