# API Reference

## REST API

**Base URL**: `https://api.buildkite.com/v2`

### Authentication

```bash
curl -H "Authorization: Bearer $BUILDKITE_API_TOKEN" \
  https://api.buildkite.com/v2/user
```

Tokens: https://buildkite.com/user/api-access-tokens. Scoped to orgs and permissions. Now support expiry dates.

### Pagination

Via `Link` header with `next`, `prev`, `first`, `last`. Params: `page` (default 1), `per_page` (default 30, max 100).

### Key Endpoints

**Pipelines:**

```
GET    /v2/organizations/{org}/pipelines
GET    /v2/organizations/{org}/pipelines/{slug}
POST   /v2/organizations/{org}/pipelines
PATCH  /v2/organizations/{org}/pipelines/{slug}
DELETE /v2/organizations/{org}/pipelines/{slug}
```

**Builds:**

```
GET    /v2/builds                                              # All builds
GET    /v2/organizations/{org}/pipelines/{pipeline}/builds     # Pipeline builds
GET    /v2/organizations/{org}/pipelines/{pipeline}/builds/{n} # Single build
POST   /v2/organizations/{org}/pipelines/{pipeline}/builds     # Create build
PUT    .../builds/{n}/cancel                                   # Cancel
PUT    .../builds/{n}/rebuild                                  # Rebuild
```

Filter: `?state=passed`, `?branch=main`, `?created_from=2024-01-01`, `?meta_data[key]=value`

**Jobs:**

```
PUT    .../jobs/{id}/retry         # Retry
PUT    .../jobs/{id}/unblock       # Unblock (block/input steps)
GET    .../jobs/{id}/log           # Job log
GET    .../jobs/{id}/env           # Job environment
```

**Artifacts:**

```
GET    .../builds/{n}/artifacts     # List for build
GET    .../jobs/{id}/artifacts      # List for job
GET    .../artifacts/{id}/download  # Download
```

**Annotations:**

```
GET    .../builds/{n}/annotations
POST   .../builds/{n}/annotations
DELETE .../builds/{n}/annotations/{uuid}
```

**Agents:**

```
GET    /v2/organizations/{org}/agents
PUT    .../agents/{id}/stop
PUT    .../agents/{id}/pause
PUT    .../agents/{id}/resume
```

Also: Teams, Clusters, Queues, Agent Tokens, Pipeline Templates, Rules — all with full CRUD.

### Client Libraries

Go: `go-buildkite`, Python: `pybuildkite`, Ruby: `buildkit` (Shopify), Java: `buildkite-api-client`, Swift: `buildkite-swift`, PHP: `buildkite-php`, PowerShell: `PSBuildkite`.

## GraphQL API

**Endpoint**: `https://graphql.buildkite.com/v1` (POST only, `application/json`)

```bash
curl https://graphql.buildkite.com/v1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ viewer { user { name } } }"}'
```

Token requires **Enable GraphQL API Access** permission. Interactive console: https://buildkite.com/user/graphql/console

Relay-compatible: global node IDs (base64), Connections/Edges pagination. Use `node(id: "...")` for direct access.

Key mutations: `buildAnnotate`, `buildCreate`, `buildCancel`, pipeline/team/cluster CRUD.

## bk CLI

```bash
bk auth login          # OAuth auth (v3.32.0+, stored in OS keychain)
bk auth logout
bk auth status
bk auth switch         # Switch org
```

## buildkite-agent CLI

```bash
# Core
buildkite-agent start                          # Start agent
buildkite-agent pipeline upload [file]         # Upload pipeline steps
buildkite-agent meta-data set "key" "value"    # Set build metadata
buildkite-agent meta-data get "key"            # Get build metadata
buildkite-agent annotate "msg" --style info    # Create annotation
buildkite-agent artifact upload "path"         # Upload artifact
buildkite-agent artifact download "glob" dst   # Download artifact

# Advanced
buildkite-agent step update "field" "value"    # Update step attributes
buildkite-agent step get "field"               # Get step attributes
buildkite-agent env get                        # Get job env
buildkite-agent env set KEY=VALUE              # Set job env
buildkite-agent lock acquire "name"            # Distributed lock
buildkite-agent lock release "name"
buildkite-agent oidc request-token             # Request OIDC token
buildkite-agent secret get "name"              # Get Buildkite Secret
buildkite-agent redactor add "string"          # Redact from logs
```
