import { applyCurrentBuildImageOverrides } from "./release-configuration.ts";

const versions = {
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "jordanlambrecht/tracker-tracker":
    "2.8.9@sha256:27b93eb839812c7ccaf03b1024f31d23b5981f8fcc13257447e2082100b7a71c",
  // renovate: datasource=helm registryUrl=https://1password.github.io/connect-helm-charts/ versioning=semver
  connect: "2.4.1",
  // renovate: datasource=helm registryUrl=https://argoproj.github.io/argo-helm versioning=semver
  "argo-cd": "10.2.1",
  // renovate: datasource=helm registryUrl=https://charts.jetstack.io versioning=semver-coerced
  "cert-manager": "v1.21.0",
  // renovate: datasource=helm registryUrl=https://intel.github.io/helm-charts/ versioning=semver
  "intel-device-plugins-operator": "0.36.0",
  // renovate: datasource=helm registryUrl=https://kubernetes-sigs.github.io/node-feature-discovery/charts versioning=semver
  "node-feature-discovery": "0.19.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "kube-prometheus-stack": "87.21.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-adapter": "5.3.0",
  // renovate: datasource=helm registryUrl=https://prometheus-community.github.io/helm-charts versioning=semver
  "prometheus-blackbox-exporter": "11.16.0",
  // renovate: datasource=helm registryUrl=https://pkgs.tailscale.com/helmcharts versioning=semver
  "tailscale-operator": "1.98.9",
  // renovate: datasource=github-releases versioning=semver
  "adyanth/cloudflare-operator": "v0.13.1",
  // not managed by renovate — built from packages/streambot; CI's version commit-back fills the
  // real tag@digest after the first image push. Seed digest is a placeholder until then.
  "shepherdjerred/streambot":
    "2.0.0-8286@sha256:1b567074daef10d0847c615abf17b4a21d11a2b34368c731f6b14acba8034c21",
  // not managed by renovate — built from upstream redlib's glibc Dockerfile.ubuntu
  // at REDLIB_SOURCE_REF (pinned in the since-removed CI pipeline). The published image is
  // musl/Alpine, which Reddit blocks during OAuth (redlib-org/redlib#551 —
  // "Failed to create OAuth client: 401 Unauthorized"); the glibc build works.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/redlib":
    "2.0.0-6673@sha256:d7ee40afb22c6447aab6b370bde0b1b1aafa0a6dae5486b2cfd678ddafa8f335",
  // not managed by renovate — built from upstream selmant/shelfbridge at
  // SHELFBRIDGE_SOURCE_REF (packages/homelab/images/shelfbridge/Dockerfile);
  // upstream publishes goreleaser binaries only, no container image.
  // CI's version commit-back fills the real tag@digest after the first image
  // push; the seed digest below is a placeholder until then.
  "shepherdjerred/shelfbridge":
    "2.0.0-6673@sha256:87072a935d3f9967641e1e67c15a922d89aff4c06fb066a368c8e9e795d664b7",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  // java25 variant: Paper 26.1.2 (pinned below) requires Java 25+; the java21
  // image crashes every server at startup ("Minecraft 26.1 and newer requires
  // running the server with Java 25 or above"). Keep this Java major in sync
  // with the paper pin.
  "itzg/minecraft-server":
    "2026.7.2-java25@sha256:6ec1110e4d9236d00ae9436a3e4a5929583e5b19cc94b756a7c603f7cf647a77",
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
    "v3.4.0@sha256:d206d9e4056bb90178297df58047791196e7721e6dc19384579b0530702fe086",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "kometateam/kometa":
    "v2.4.5@sha256:a376a1818196cde159b5a4d5a6ad55411415f7b5bc38d8a27e8c718bae7f0ddd",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "linuxserver/prowlarr":
    "2.5.2@sha256:2f3d31307beba3ba2dd226d191f5f5c14ee3b4d8b49277c64683f5ed97083179",
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
  // not managed by renovate — updated by version commit-back
  // Self-built from pinned upstream source with the Chinese Google Books patch.
  "shepherdjerred/bindery":
    "2.0.0-6874@sha256:2833a75913988f67adfdf2eb92f0e63c1fa1cc81f503f156fb1474272b0b5472",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  // Calibre-Web Automated — library + ingest + Send-to-Kindle path
  "crocodilestick/calibre-web-automated":
    "v4.0.6@sha256:c31a738b6d5ec6982c050063dd3f063b6943eb1051fc81144789f840d9093a8d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "timothyjmiller/cloudflare-ddns":
    "latest@sha256:e78ef9df27d82edafbcce232681be398e6faf7c1f158b80b091b8c6a5b1b8879",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "cloudflare/cloudflared":
    "2026.7.3@sha256:e39ee8da81ad5e05d77f38d2f51c60ca51bf2a8450ac3abab50c17fdb91d91bf",
  // not managed by renovate (upstream tailscale/golink ships a rolling `main` tag)
  "tailscale/golink":
    "main@sha256:dc62e0d38bd2633d3090e6ca1de327471c376afe0457d397c4f111e5a98d8a88",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "home-assistant/home-assistant":
    "2026.7.4@sha256:5a531753cea96444200158fc2b0ac7ccd739291ec50414877b396de6e0bb29b3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bropat/eufy-security-ws":
    "3.1.0@sha256:d41169205f4e20e1e7e173283aaf8bb2d68e2abecb42bc1500a5fac5bb7a8750",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "zwavejs/zwave-js-ui":
    "11.22.0@sha256:f24115c115f98a1cd69fea620bf20180be17889e9ae3c58ceabf5df1bc56c2a8",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=docker
  "koush/scrypted":
    "v0.144.1-noble-full@sha256:25440767192b0d4a0709f50388d14cdf365ba6bff59d04e40a41ca2b7b9a6b70",
  // renovate: datasource=github-releases versioning=semver
  "fuatakgun/eufy_security": "v8.2.4",
  // renovate: datasource=github-releases versioning=semver
  "basnijholt/adaptive-lighting": "v1.31.0",
  // renovate: datasource=github-releases versioning=semver
  "JeffSteinbok/hass-dreo": "v1.10.9",
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
  pyroscope: "2.2.0",
  // renovate: datasource=helm registryUrl=https://grafana.github.io/helm-charts versioning=semver
  alloy: "1.11.0",
  // renovate: datasource=helm registryUrl=https://openebs.github.io/openebs versioning=semver
  openebs: "4.5.1",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/scout-for-lol/beta":
    "2.0.0-8286@sha256:7207b9622a2d2408b0f32b623dd62696fc513f850d5875f54509ef82401721b3",
  // Prod promotion = merging the Renovate PR for this pin. Each 2.0.0-<n>
  // tag is minted by the scout-tag-release CI step only after site version
  // <n> is archived, pointing at the backend digest beta serves it against —
  // so every tag Renovate can offer is a complete backend+site pair. The
  // scout-prod-reconcile step derives the prod site version from this pin's
  // tag portion. Only ever pin a minted tag (semver caveat: if the release
  // base moves off 2.0.0-, this pin needs one manual edit).
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/scout-for-lol
  "shepherdjerred/scout-for-lol/prod":
    "2.0.0-7926@sha256:026d26b2304c9b629c4b6f59628eccea7457d370c9f9b57ae396afcefc46048b",
  // not managed by renovate — beta updated by version-commit-back
  "shepherdjerred/starlight-karma-bot/beta":
    "2.0.0-8286@sha256:8c6f913014c97b232bdf803d0af2181164f8cddd65a2c66c9086afca3c0b55c5",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver packageName=shepherdjerred/starlight-karma-bot
  "shepherdjerred/starlight-karma-bot/prod":
    "2.0.0-7909@sha256:7e904d0538a6e0456271b50fe58c520e18159440f3b68b6073a307d7862c4972",
  // not managed by renovate
  "shepherdjerred/birmel":
    "2.0.0-8311@sha256:d859a5124cbf003cd85fd201c36cfdcfd806294cabe0ef9002f3b147363b4275",
  // not managed by renovate — placeholder digest; CI version-commit-back fills
  // the real digest after the first successful scout-evals image push.
  "shepherdjerred/scout-evals":
    "2.0.0-8286@sha256:2229709eb3cc4071115b9e0b8a897a4e008c31f2450004945979afd1ed43b1c6",
  // not managed by renovate
  "shepherdjerred/discord-plays-pokemon":
    "2.0.0-8286@sha256:6fca8ed159802a917a2e0d680ec7cdf9011692a52aff669c6c8827d4e1cb1d5b",
  // not managed by renovate — placeholder digest; CI version-commit-back fills
  // the real digest after the first successful image push.
  "shepherdjerred/discord-plays-mario-kart":
    "2.0.0-8286@sha256:77b8a3d3343904bf3620088d0c9b39017612f7a060fa043f3e9daaedda0b82f8",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "freshrss/freshrss":
    "1.29.1@sha256:ab6b363102ccdbc39f6a62db926f567c61a5289bf25ba460f1c34423d8cc1a4d",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "pinchtab/pinchtab":
    "0.15.0@sha256:a4d5ac974eb093adf0211389257179f4f4ca16369f91479be67bd881c376e716",
  // renovate: datasource=docker registryUrl=https://ghcr.io/buildkite/helm versioning=semver packageName=agent-stack-k8s
  "agent-stack-k8s":
    "0.46.3@sha256:30742cb7d592ab48ac223b1e12004dc759eaf3a18f2e5f96eaf54b6123f944d4",
  // Self-hosted Turborepo remote cache (backs the workspace task-graph
  // replatform — packages/docs/plans/2026-07-12_workspace-taskgraph-replatform.md).
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "ducktors/turborepo-remote-cache":
    "2.11.5@sha256:dfd1ce24cc4bdd59113e3ba68c881269fda5dd5929e58e2ea95010c51c09056d",
  // renovate: datasource=docker registryUrl=https://registry.k8s.io versioning=semver packageName=kueue/charts/kueue
  kueue:
    "0.18.2@sha256:156fbc8c6752b08cf66a2324fed33e269e0a64e54dd8d70d51118065bca651af",
  // Persistent BuildKit daemon backing CI image builds (bounded-GC cache on a
  // compressed ZFS PVC, replacing the per-run throwaway builder inside dind —
  // moves the build-layer write storm off the xfs /var system disk).
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "moby/buildkit":
    "v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec",
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
  "kubernetes/kubernetes": "v1.36.3",
  // The papermc datasource lists both 2-part families (e.g. "26.2") and 3-part
  // builds (e.g. "26.1.2"); strict semver drops the 2-part ones, so it never
  // surfaced "26.2". semver-coerced compares them all, and the datasource
  // transform now filters pre-releases (-rc/-pre) so only stable builds appear.
  // renovate: datasource=custom.papermc versioning=semver-coerced
  paper: "26.1.2",
  // renovate: datasource=docker registryUrl=https://ghcr.io/recyclarr versioning=docker
  recyclarr:
    "8.7.0@sha256:2d6107f758d882a59fe9d646aa54fa8a5a4fb7a40995125fade575652a3f7871",
  // renovate: datasource=github-releases versioning=semver
  "siderolabs/talos": "1.13.7",
  // renovate: datasource=helm registryUrl=https://opensource.zalando.com/postgres-operator/charts/postgres-operator versioning=semver
  "postgres-operator": "2.0.0",
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
  redis: "27.0.18",
  // renovate: datasource=helm registryUrl=https://seaweedfs.github.io/seaweedfs/helm versioning=semver
  seaweedfs: "4.40.0",
  // renovate: datasource=helm registryUrl=https://helm.plane.so/ versioning=semver
  "plane-enterprise": "3.1.0",
  // The Plane Commercial chart and application version must remain paired.
  // not managed by renovate
  "plane-enterprise-app": "v3.0.1",
  // renovate: datasource=helm registryUrl=https://charts.bitnami.com/bitnami versioning=semver
  mariadb: "26.2.0",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "bitnami/mariadb":
    "latest@sha256:991b66aa2a16e9cf518bc6c36b32d21fcad14b5f199b5a1a8bcf4637fcae03bb",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "bitnami/mysqld-exporter":
    "latest@sha256:52e63f43bc03a4e6fb173864826845c81ec5002d5a4184ed69e073417dc6470b",
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
  // Alpine-based image bundling yq + busybox coreutils (sh/find/cmp/diff/cp);
  // used by the Minecraft config-drift init container for semantic YAML/JSON
  // comparison (see misc/minecraft-drift-check.ts).
  "mikefarah/yq":
    "latest@sha256:11a1f0b604b13dbbdc662260d8db6f644b22d8553122a25c1b5b2e8713ca6977",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/alpine":
    "latest@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/haproxy":
    "3.4.2-alpine@sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "mccloud/bazarr-openai-whisperbridge":
    "latest@sha256:10212b643245b97d0369d1be3448cc35e61f7df78b4861cf7df90608e9c803d3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "library/debian":
    "bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  matomo:
    "5.12.0@sha256:85d27206a4acdd43259909aa00cab1913dec88cfba53e1ce66a51e6caa430a55",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "library/nginx":
    "1.29.1-alpine@sha256:42a516af16b852e33b7682d5ef8acbd5d13fe08fecadc7ed98605ba5e3b26ab8",
  // renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
  "tbxark/mcp-proxy":
    "v0.43.2@sha256:70c0e02d39c4c0898e610b3a30954f7930628fa6f4fb447bad14c32382a25879",
  // mcp-gateway downstream npm MCP servers. Pinned + Renovate-tracked so cold
  // starts are reproducible instead of `npx -y` grabbing latest. Substituted
  // into mcp-gateway/config.json at synth time.
  // renovate: datasource=npm versioning=npm
  "@r-huijts/canvas-mcp": "1.3.0",
  // renovate: datasource=npm versioning=npm
  "@automatearmy/email-reader-mcp": "1.0.3",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  "bugsink/bugsink":
    "2.5.0@sha256:b697016950d8aa7d94020def15bc2727e8fc40148f079884ae4cdacf7ea1e9a3",
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
    "2.0.0-8286@sha256:21c9a24f08bb4f62c283ee857cdf0d6a1eb161dc057980d76ab7e7a0651ba533",
  // Custom obsidian-headless image - Official Obsidian Headless CLI for vault sync
  // not managed by renovate
  "shepherdjerred/obsidian-headless":
    "2.0.0-6529@sha256:fd1e89af7747c0b0ad2c650c6eab0c60452464e83dfcfb3bedbf967f15e7e645",
  // Custom mcp-gateway image - tbxark/mcp-proxy + prebuilt edstem-mcp (rob-9/edstem-mcp)
  // not managed by renovate
  "shepherdjerred/mcp-gateway":
    "2.0.0-6690@sha256:719ad2ddcf05af01be975f984cb2ef8a3139302724e6d2cb01111cb50b348aa9",
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
    "2.0.0-8286@sha256:087c4a63c218f1cff2c3cdae29b873addd6b1d2afdfac8c4c91dc423c239305a",
  // Custom TRMNL dashboard image - updated by CI pipeline
  // not managed by renovate
  "shepherdjerred/trmnl-dashboard":
    "2.0.0-8286@sha256:dc8c4e7f3029aef81ea06d4dd15552ca7c6f885778cb9a6faf3a73f6a9e24c19",
};

applyCurrentBuildImageOverrides(versions);

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
 *   curl -fSL "https://codeload.github.com/fuatakgun/eufy_security/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const EUFY_TARBALL_SHA256 =
  "b744aac0ce03a8a75de5100c672957504173c20cbe2ac0fc4d09d5bc75c59411";

/**
 * SHA-256 of the GitHub release tarball for `basnijholt/adaptive-lighting`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["basnijholt/adaptive-lighting"])')
 *   curl -fSL "https://codeload.github.com/basnijholt/adaptive-lighting/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const ADAPTIVE_LIGHTING_TARBALL_SHA256 =
  "9c390346e022651778aaed613946a5275a503966274dfa399b966e0eb90f7ca4";

/**
 * SHA-256 of the GitHub release tarball for `JeffSteinbok/hass-dreo`, pinned
 * to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["JeffSteinbok/hass-dreo"])')
 *   curl -fSL "https://codeload.github.com/JeffSteinbok/hass-dreo/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const DREO_TARBALL_SHA256 =
  "76e5a6b7d9f638597a50b6b6135acf714fd7fe424ea68c021079dd99326d0631";

/**
 * SHA-256 of the GitHub release tarball for `magico13/ha-emporia-vue`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["magico13/ha-emporia-vue"])')
 *   curl -fSL "https://codeload.github.com/magico13/ha-emporia-vue/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const EMPORIA_VUE_TARBALL_SHA256 =
  "29595c369bedcf86577aedc73398325120be1b6bdcd154a61e75c3bda77d2d2d";

/**
 * SHA-256 of the GitHub release tarball for `dlarrick/hass-kumo`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["dlarrick/hass-kumo"])')
 *   curl -fSL "https://codeload.github.com/dlarrick/hass-kumo/tar.gz/refs/tags/$VERSION" | sha256sum
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
 *   curl -fSL "https://codeload.github.com/kgelinas/Mysa_HA/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const MYSA_TARBALL_SHA256 =
  "9d8120570bec8f1befedac4b20d67d1fb726da8fdf249305e21fae0213d1a0d9";

/**
 * SHA-256 of the GitHub release tarball for `jjjonesjr33/petlibro`, pinned
 * to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["jjjonesjr33/petlibro"])')
 *   curl -fSL "https://codeload.github.com/jjjonesjr33/petlibro/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const PETLIBRO_TARBALL_SHA256 =
  "42203f0fc8ea7a9fa80877633b36ed0cfd4ef4f86f904a994d35b121e44c607f";

/**
 * SHA-256 of the GitHub release tarball for `AlexxIT/SonoffLAN`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["AlexxIT/SonoffLAN"])')
 *   curl -fSL "https://codeload.github.com/AlexxIT/SonoffLAN/tar.gz/refs/tags/$VERSION" | sha256sum
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
 *   curl -fSL "https://codeload.github.com/elax46/custom-brand-icons/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const CUSTOM_BRAND_ICONS_TARBALL_SHA256 =
  "3f1d70118cb1fa4d4ebbccaedf8c168a8a7e34ea1cfed5c18b01e7fb1c01d6de";

export default versions;
