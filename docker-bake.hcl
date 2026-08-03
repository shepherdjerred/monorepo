# Bake definition for every service/infra image CI builds. One `docker buildx
# bake` builds targets IN PARALLEL on one BuildKit daemon, deduplicating the
# identical workspace bun-install layer the app images share — replacing the
# serial per-image loop (45-52 min images step, build 5644/5656).
#
# CI (.buildkite/scripts/bake-images.ts) invokes this with
# VERSION/GIT_SHA/PUSH_CACHE set; local `docker buildx bake <target>` works
# with the dev defaults (cache is read-only unless PUSH_CACHE=true — writing
# the ghcr buildcache refs needs a docker-container builder + push creds).
# Per-package `docker:build` scripts remain for one-off local builds; target
# definitions here must stay in sync with them.
#
// CI solves `smoke` targets without an exporter, then pushes the production
// target directly to GHCR. Local bake calls retain convenient `<name>:dev`
// tags for the package-owned Docker wrappers.

variable "REGISTRY" {
  default = "ghcr.io/shepherdjerred"
}

# Baked into app images as ARG VERSION / GIT_SHA (declared last in every
# Dockerfile, so they never bust build caches).
variable "VERSION" {
  default = "dev"
}
variable "GIT_SHA" {
  default = "unknown"
}
# Deterministic hash of the scout tRPC contract sources (computed by
# packages/scout-for-lol/scripts/contract-hash.ts). Baked only into the
# scout-for-lol image; the SPA build stamps the same hash so the app can
# detect frontend↔backend contract skew at runtime.
variable "CONTRACT_HASH" {
  default = "dev"
}

# "true" on main: export per-target registry cache (mode=max). PRs and local
# builds read cache but never write it.
variable "PUSH_CACHE" {
  default = "false"
}
variable "PUSH_IMAGES" {
  default = "false"
}
# Caddy's smoke stage parses the generated production configuration. Secrets
# are target attributes in Bake (not a `docker buildx bake` CLI flag), so keep
# the ephemeral source path out of the Dockerfile and pass it only at solve
# time.
variable "CADDYFILE_SMOKE_PATH" {
  default = ""
}
function "cachefrom" {
  params = [name]
  result = ["type=registry,ref=${REGISTRY}/${name}:buildcache"]
}

function "cacheto" {
  params = [name]
  result = equal(PUSH_CACHE, "true") ? ["type=registry,ref=${REGISTRY}/${name}:buildcache,mode=max,image-manifest=true"] : []
}
function "imagetags" {
  params = [name]
  # Main publishes an immutable source-addressed candidate. CI resolves this
  # tag to its manifest digest, smoke-tests that exact digest, and promotes
  # only the digest through GitOps metadata. Mutable latest tags bypass that
  # contract and are intentionally not emitted.
  result = equal(PUSH_IMAGES, "true") ? ["${REGISTRY}/${name}:candidate-${GIT_SHA}"] : ["${name}:dev"]
}

group "default" {
  targets = ["app", "infra"]
}

# ── App images: repo-root context, VERSION/GIT_SHA args ─────────────────────
group "app" {
  targets = [
    "birmel",
    "tasknotes-server",
    "starlight-karma-bot",
    "streambot",
    "temporal-worker",
    "trmnl-dashboard",
    "scout-for-lol",
    "scout-evals",
    "discord-plays-pokemon",
    "discord-plays-mario-kart",
  ]
}

target "_app" {
  context = "."
  target = "image"
  args = {
    VERSION = VERSION
    GIT_SHA = GIT_SHA
  }
}

target "birmel" {
  inherits   = ["_app"]
  dockerfile = "packages/birmel/Dockerfile"
  tags       = imagetags("birmel")
  cache-from = cachefrom("birmel")
  cache-to   = cacheto("birmel")
}

target "tasknotes-server" {
  inherits   = ["_app"]
  dockerfile = "packages/tasknotes-server/Dockerfile"
  tags       = imagetags("tasknotes-server")
  cache-from = cachefrom("tasknotes-server")
  cache-to   = cacheto("tasknotes-server")
}

target "scout-evals" {
  inherits   = ["_app"]
  dockerfile = "packages/scout-for-lol/packages/evals/Dockerfile"
  tags       = imagetags("scout-evals")
  cache-from = cachefrom("scout-evals")
  cache-to   = cacheto("scout-evals")
}

target "starlight-karma-bot" {
  inherits   = ["_app"]
  dockerfile = "packages/starlight-karma-bot/Dockerfile"
  tags       = imagetags("starlight-karma-bot")
  cache-from = cachefrom("starlight-karma-bot")
  cache-to   = cacheto("starlight-karma-bot")
}

target "streambot" {
  inherits   = ["_app"]
  dockerfile = "packages/streambot/Dockerfile"
  tags       = imagetags("streambot")
  cache-from = cachefrom("streambot")
  cache-to   = cacheto("streambot")
}

target "temporal-worker" {
  inherits   = ["_app"]
  dockerfile = "packages/temporal/Dockerfile"
  tags       = imagetags("temporal-worker")
  cache-from = cachefrom("temporal-worker")
  cache-to   = cacheto("temporal-worker")
}

target "trmnl-dashboard" {
  inherits   = ["_app"]
  dockerfile = "packages/trmnl-dashboard/Dockerfile"
  tags       = imagetags("trmnl-dashboard")
  cache-from = cachefrom("trmnl-dashboard")
  cache-to   = cacheto("trmnl-dashboard")
}

target "scout-for-lol" {
  inherits   = ["_app"]
  dockerfile = "packages/scout-for-lol/packages/backend/Dockerfile"
  tags       = imagetags("scout-for-lol")
  args = {
    VERSION       = VERSION
    GIT_SHA       = GIT_SHA
    CONTRACT_HASH = CONTRACT_HASH
  }
  cache-from = cachefrom("scout-for-lol")
  cache-to   = cacheto("scout-for-lol")
}

target "discord-plays-pokemon" {
  inherits   = ["_app"]
  dockerfile = "packages/discord-plays-pokemon/Dockerfile"
  tags       = imagetags("discord-plays-pokemon")
  cache-from = cachefrom("discord-plays-pokemon")
  cache-to   = cacheto("discord-plays-pokemon")
}

target "discord-plays-mario-kart" {
  inherits   = ["_app"]
  dockerfile = "packages/discord-plays-mario-kart/Dockerfile"
  tags       = imagetags("discord-plays-mario-kart")
  cache-from = cachefrom("discord-plays-mario-kart")
  cache-to   = cacheto("discord-plays-mario-kart")
}

# ── Homelab infra images: self-contained contexts ────────────────────────────
group "infra" {
  targets = ["bindery", "caddy-s3proxy", "obsidian-headless", "mcp-gateway", "redlib", "shelfbridge"]
}

target "bindery" {
  context    = "packages/homelab/images/bindery"
  target     = "image"
  tags       = imagetags("bindery")
  cache-from = cachefrom("bindery")
  cache-to   = cacheto("bindery")
}

target "caddy-s3proxy" {
  context    = "packages/homelab/images/caddy-s3proxy"
  target     = "image"
  tags       = imagetags("caddy-s3proxy")
  secret     = CADDYFILE_SMOKE_PATH != "" ? ["id=caddyfile,src=${CADDYFILE_SMOKE_PATH}"] : []
  cache-from = cachefrom("caddy-s3proxy")
  cache-to   = cacheto("caddy-s3proxy")
}

target "obsidian-headless" {
  context    = "packages/homelab/images/obsidian-headless"
  target     = "image"
  tags       = imagetags("obsidian-headless")
  cache-from = cachefrom("obsidian-headless")
  cache-to   = cacheto("obsidian-headless")
}

target "mcp-gateway" {
  context    = "packages/homelab/images/mcp-gateway"
  target     = "image"
  tags       = imagetags("mcp-gateway")
  cache-from = cachefrom("mcp-gateway")
  cache-to   = cacheto("mcp-gateway")
}

target "redlib" {
  context    = "packages/homelab/images/redlib"
  target     = "image"
  tags       = imagetags("redlib")
  cache-from = cachefrom("redlib")
  cache-to   = cacheto("redlib")
}

target "shelfbridge" {
  context    = "packages/homelab/images/shelfbridge"
  target     = "image"
  tags       = imagetags("shelfbridge")
  cache-from = cachefrom("shelfbridge")
  cache-to   = cacheto("shelfbridge")
}
