# Bake definition for every service/infra image CI builds. One `docker buildx
# bake` builds targets IN PARALLEL on one BuildKit daemon, deduplicating the
# identical workspace bun-install layer the app images share — replacing the
# serial per-image loop (45-52 min images step, build 5644/5656).
#
# CI (.buildkite/scripts/bake-images.sh) invokes this with
# VERSION/GIT_SHA/PUSH_CACHE set; local `docker buildx bake <target>` works
# with the dev defaults (cache is read-only unless PUSH_CACHE=true — writing
# the ghcr buildcache refs needs a docker-container builder + push creds).
# Per-package `docker:build` scripts remain for one-off local builds; target
# definitions here must stay in sync with them.
#
# Tags are `<name>:dev` so the per-package smoke scripts (`docker run
# <name>:dev`) work unchanged; CI re-tags/pushes after smoke passes.

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

# "true" on main: export per-target registry cache (mode=max). PRs and local
# builds read cache but never write it.
variable "PUSH_CACHE" {
  default = "false"
}
function "cachefrom" {
  params = [name]
  result = ["type=registry,ref=${REGISTRY}/${name}:buildcache"]
}

function "cacheto" {
  params = [name]
  result = equal(PUSH_CACHE, "true") ? ["type=registry,ref=${REGISTRY}/${name}:buildcache,mode=max,image-manifest=true"] : []
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
    "discord-plays-pokemon",
    "discord-plays-mario-kart",
  ]
}

target "_app" {
  context = "."
  args = {
    VERSION = VERSION
    GIT_SHA = GIT_SHA
  }
}

target "birmel" {
  inherits   = ["_app"]
  dockerfile = "packages/birmel/Dockerfile"
  tags       = ["birmel:dev"]
  cache-from = cachefrom("birmel")
  cache-to   = cacheto("birmel")
}

target "tasknotes-server" {
  inherits   = ["_app"]
  dockerfile = "packages/tasknotes-server/Dockerfile"
  tags       = ["tasknotes-server:dev"]
  cache-from = cachefrom("tasknotes-server")
  cache-to   = cacheto("tasknotes-server")
}

target "starlight-karma-bot" {
  inherits   = ["_app"]
  dockerfile = "packages/starlight-karma-bot/Dockerfile"
  tags       = ["starlight-karma-bot:dev"]
  cache-from = cachefrom("starlight-karma-bot")
  cache-to   = cacheto("starlight-karma-bot")
}

target "streambot" {
  inherits   = ["_app"]
  dockerfile = "packages/streambot/Dockerfile"
  tags       = ["streambot:dev"]
  cache-from = cachefrom("streambot")
  cache-to   = cacheto("streambot")
}

target "temporal-worker" {
  inherits   = ["_app"]
  dockerfile = "packages/temporal/Dockerfile"
  tags       = ["temporal-worker:dev"]
  cache-from = cachefrom("temporal-worker")
  cache-to   = cacheto("temporal-worker")
}

target "trmnl-dashboard" {
  inherits   = ["_app"]
  dockerfile = "packages/trmnl-dashboard/Dockerfile"
  tags       = ["trmnl-dashboard:dev"]
  cache-from = cachefrom("trmnl-dashboard")
  cache-to   = cacheto("trmnl-dashboard")
}

target "scout-for-lol" {
  inherits   = ["_app"]
  dockerfile = "packages/scout-for-lol/packages/backend/Dockerfile"
  tags       = ["scout-for-lol:dev"]
  cache-from = cachefrom("scout-for-lol")
  cache-to   = cacheto("scout-for-lol")
}

target "discord-plays-pokemon" {
  inherits   = ["_app"]
  dockerfile = "packages/discord-plays-pokemon/Dockerfile"
  tags       = ["discord-plays-pokemon:dev"]
  cache-from = cachefrom("discord-plays-pokemon")
  cache-to   = cacheto("discord-plays-pokemon")
}

target "discord-plays-mario-kart" {
  inherits   = ["_app"]
  dockerfile = "packages/discord-plays-mario-kart/Dockerfile"
  tags       = ["discord-plays-mario-kart:dev"]
  cache-from = cachefrom("discord-plays-mario-kart")
  cache-to   = cacheto("discord-plays-mario-kart")
}

# ── Homelab infra images: self-contained contexts, no VERSION/GIT_SHA ───────
group "infra" {
  targets = ["caddy-s3proxy", "obsidian-headless", "mcp-gateway", "redlib"]
}

target "caddy-s3proxy" {
  context    = "packages/homelab/images/caddy-s3proxy"
  tags       = ["caddy-s3proxy:dev"]
  cache-from = cachefrom("caddy-s3proxy")
  cache-to   = cacheto("caddy-s3proxy")
}

target "obsidian-headless" {
  context    = "packages/homelab/images/obsidian-headless"
  tags       = ["obsidian-headless:dev"]
  cache-from = cachefrom("obsidian-headless")
  cache-to   = cacheto("obsidian-headless")
}

target "mcp-gateway" {
  context    = "packages/homelab/images/mcp-gateway"
  tags       = ["mcp-gateway:dev"]
  cache-from = cachefrom("mcp-gateway")
  cache-to   = cacheto("mcp-gateway")
}

target "redlib" {
  context    = "packages/homelab/images/redlib"
  tags       = ["redlib:dev"]
  cache-from = cachefrom("redlib")
  cache-to   = cacheto("redlib")
}
