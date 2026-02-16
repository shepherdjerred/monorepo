# Go Modules and Tooling

Comprehensive reference for Go modules, workspaces, dependency management, golangci-lint, go vet, gopls, build tags, cross-compilation, and popular packages.

## Go Modules

### Module Initialization

```bash
# Create new module
go mod init github.com/user/project

# Creates go.mod:
# module github.com/user/project
# go 1.24
```

### go.mod File Structure

```go
module github.com/user/project

go 1.24

// Tool dependencies (Go 1.24+)
tool (
    golang.org/x/tools/cmd/stringer
    github.com/golangci/golangci-lint/v2/cmd/golangci-lint
)

require (
    github.com/go-chi/chi/v5 v5.1.0
    github.com/jackc/pgx/v5 v5.7.0
    go.uber.org/zap v1.27.0
    golang.org/x/sync v0.8.0
)

require (
    // Indirect dependencies (managed by go mod tidy)
    golang.org/x/sys v0.25.0 // indirect
    golang.org/x/text v0.18.0 // indirect
)

// Replace directives (local development or forks)
replace github.com/original/pkg => ../local-pkg
replace github.com/original/pkg => github.com/fork/pkg v1.0.0

// Exclude a specific version
exclude github.com/broken/pkg v1.2.3

// Retract versions (used by module authors)
retract (
    v1.0.0 // Published accidentally
    [v1.1.0, v1.2.0] // Contains critical bug
)
```

### Dependency Management Commands

```bash
# Add dependency
go get github.com/pkg/errors               # Latest
go get github.com/pkg/errors@v0.9.1        # Specific version
go get github.com/pkg/errors@latest         # Latest tagged
go get github.com/pkg/errors@main           # Branch tip
go get github.com/pkg/errors@abc1234        # Specific commit

# Update dependency
go get -u github.com/pkg/errors             # Latest minor/patch
go get -u=patch github.com/pkg/errors       # Latest patch only
go get -u ./...                             # Update all direct deps

# Remove unused dependencies
go mod tidy

# Show diff without modifying (Go 1.23+)
go mod tidy -diff

# Download dependencies to local cache
go mod download

# Vendor dependencies
go mod vendor

# Verify checksums
go mod verify

# Show dependency graph
go mod graph

# Show why a dependency is needed
go mod why github.com/pkg/errors
go mod why -m golang.org/x/sys

# Edit go.mod programmatically
go mod edit -require github.com/pkg/errors@v0.9.1
go mod edit -droprequire github.com/pkg/errors
go mod edit -replace old=new@v1.0.0
go mod edit -dropreplace old
go mod edit -go 1.24
go mod edit -json  # Output as JSON
```

### Tool Dependencies (Go 1.24+)

Before Go 1.24, tool dependencies required a `tools.go` file with blank imports. Now use `tool` directives:

```bash
# Add tool dependency
go get -tool golang.org/x/tools/cmd/stringer
go get -tool github.com/golangci/golangci-lint/v2/cmd/golangci-lint
go get -tool google.golang.org/protobuf/cmd/protoc-gen-go

# Run tool
go tool stringer -type=Color
go tool golangci-lint run
go tool protoc-gen-go

# In go.mod
tool (
    golang.org/x/tools/cmd/stringer
    github.com/golangci/golangci-lint/v2/cmd/golangci-lint
)
```

### Semantic Versioning

Go modules follow semantic versioning strictly:

```
v1.2.3
 │ │ └── Patch: bug fixes, no API changes
 │ └──── Minor: new features, backward-compatible
 └────── Major: breaking changes
```

Major version 2+ requires path suffix:
```go
import "github.com/user/repo/v2"
import "github.com/user/repo/v3/pkg"
```

### Module Proxies and Checksums

```bash
# Default proxy
GOPROXY=https://proxy.golang.org,direct

# Private modules (bypass proxy)
GONOSUMCHECK=github.com/private/*
GONOSUMDB=github.com/private/*
GOPRIVATE=github.com/private/*

# Or set in go env
go env -w GOPRIVATE=github.com/mycompany/*
```

## Workspaces

### When to Use Workspaces

Use `go.work` when developing multiple modules that depend on each other locally. Common scenarios:
- Monorepo with multiple services sharing internal packages
- Developing a library and testing it in a consumer app
- Working on a dependency fork alongside your project

### Creating a Workspace

```bash
# Initialize workspace
go work init ./service-a ./service-b ./shared-lib

# Creates go.work:
# go 1.24
# use (
#     ./service-a
#     ./service-b
#     ./shared-lib
# )

# Add another module
go work use ./service-c

# Sync dependencies across workspace modules
go work sync

# Build across workspace
go build ./...
go test ./...
```

### go.work File

```go
go 1.24

use (
    ./service-a
    ./service-b
    ./shared-lib
)

// Replace applies workspace-wide
replace github.com/external/dep => ../local-dep
```

### Workspace Best Practices

- Add `go.work` and `go.work.sum` to `.gitignore` for personal development
- Commit `go.work` only if the repo is a true monorepo where all modules are always built together
- Each module should still have its own `go.mod` and work independently
- Use `GOWORK=off` to disable workspace mode temporarily: `GOWORK=off go build ./...`

## golangci-lint

### Installation

```bash
# Binary install (recommended)
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin

# Or as tool dependency (Go 1.24+)
go get -tool github.com/golangci/golangci-lint/v2/cmd/golangci-lint

# Or brew
brew install golangci-lint
```

### Usage

```bash
# Run all enabled linters
golangci-lint run

# Run on specific packages
golangci-lint run ./pkg/...

# Auto-fix issues
golangci-lint run --fix

# Show all available linters
golangci-lint linters

# Run specific linters
golangci-lint run --enable errcheck,gosec,gocritic
```

### Configuration (v2 - .golangci.yml)

```yaml
version: "2"

linters:
  default: standard
  enable:
    - errcheck       # Check for unchecked errors
    - gocritic       # Opinionated Go linter
    - gosec          # Security checks
    - revive         # Fast, configurable Go linter
    - unconvert      # Unnecessary type conversions
    - unparam        # Unused function parameters
    - goconst        # Repeated strings that could be constants
    - prealloc       # Slice pre-allocation suggestions
    - misspell       # Spelling corrections

formatters:
  enable:
    - gofmt
    - goimports

linters-settings:
  gocritic:
    enabled-tags:
      - diagnostic
      - style
      - performance
  revive:
    rules:
      - name: exported
        arguments:
          - "checkPrivateReceivers"
  gosec:
    excludes:
      - G104  # Unhandled errors (covered by errcheck)

issues:
  exclude-dirs:
    - vendor
    - generated
  max-issues-per-linter: 50
  max-same-issues: 5
```

### Key Linters Explained

| Linter | Purpose |
|--------|---------|
| `staticcheck` | Comprehensive static analysis (included in standard) |
| `errcheck` | Detect unchecked error return values |
| `gosimple` | Simplify code (included in standard) |
| `govet` | Report suspicious constructs (included in standard) |
| `gosec` | Security-focused analysis |
| `gocritic` | Opinionated lints for style, performance, diagnostics |
| `revive` | Fast, configurable alternative to golint |
| `ineffassign` | Detect ineffectual assignments |
| `misspell` | Fix common misspellings |
| `unconvert` | Remove unnecessary type conversions |
| `prealloc` | Suggest slice pre-allocation |

## go vet

Built-in static analysis tool that catches common mistakes.

```bash
# Run all analyzers
go vet ./...

# What go vet catches:
# - printf format string mismatches
# - unreachable code
# - suspicious mutex usage (copying)
# - nil function comparisons
# - struct tag validation
# - too-new symbols for target Go version (Go 1.23+)
# - errors passed to log.Fatal instead of log.Println
```

## gopls (Go Language Server)

gopls is the official Go language server, providing IDE features.

### Configuration (.gopls.json or in editor settings)

```json
{
  "formatting.gofumpt": true,
  "ui.semanticTokens": true,
  "ui.diagnostic.analyses": {
    "unusedvariable": true,
    "shadow": true,
    "useany": true
  },
  "ui.completion.usePlaceholders": true,
  "build.directoryFilters": ["-vendor", "-node_modules"]
}
```

### gopls Features

- Auto-completion with type-aware suggestions
- Go to definition, find references, find implementations
- Rename refactoring across packages
- Code actions (organize imports, extract function, fill struct)
- Inline diagnostics from go vet and staticcheck
- Signature help and hover documentation
- Workspace symbol search

## Build Tags

### Syntax

```go
// Modern syntax (Go 1.17+): //go:build
//go:build linux && amd64

// Multiple constraints
//go:build (linux || darwin) && amd64

// Negation
//go:build !windows

// Custom build tags
//go:build integration

package mypackage
```

### File Naming Conventions

```
// Automatically applied build constraints based on filename:
file_linux.go          // Only compiled on linux
file_windows.go        // Only compiled on windows
file_amd64.go          // Only compiled for amd64
file_linux_amd64.go    // Only compiled on linux/amd64
file_test.go           // Only compiled during testing
```

### Using Build Tags

```bash
# Build with custom tag
go build -tags integration ./...
go test -tags "integration,e2e" ./...

# Multiple tags
go build -tags "debug,verbose" ./...
```

### Common Build Tag Patterns

```go
// Separate integration tests
//go:build integration

package mypackage

func TestIntegration(t *testing.T) {
    // Only runs with: go test -tags integration
}
```

```go
// Platform-specific code
//go:build darwin

package platform

func openBrowser(url string) error {
    return exec.Command("open", url).Start()
}
```

## Cross-Compilation

### Basic Cross-Compilation

```bash
# Linux AMD64
GOOS=linux GOARCH=amd64 go build -o app-linux-amd64 ./cmd/app

# Linux ARM64
GOOS=linux GOARCH=arm64 go build -o app-linux-arm64 ./cmd/app

# macOS AMD64 (Intel)
GOOS=darwin GOARCH=amd64 go build -o app-darwin-amd64 ./cmd/app

# macOS ARM64 (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o app-darwin-arm64 ./cmd/app

# Windows AMD64
GOOS=windows GOARCH=amd64 go build -o app.exe ./cmd/app

# WebAssembly
GOOS=js GOARCH=wasm go build -o app.wasm ./cmd/app
GOOS=wasip1 GOARCH=wasm go build -o app.wasm ./cmd/app

# List all supported platforms
go tool dist list
```

### CGO and Cross-Compilation

CGO is disabled by default during cross-compilation. If you need CGO:

```bash
# Disable CGO explicitly (pure Go, most portable)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app ./cmd/app

# Enable CGO with cross-compiler
CGO_ENABLED=1 CC=x86_64-linux-gnu-gcc GOOS=linux GOARCH=amd64 go build -o app ./cmd/app

# Static linking (for containers)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags '-s -w -extldflags "-static"' -o app ./cmd/app
```

### Multi-Platform Build Script

```bash
#!/bin/bash
APP=myapp
VERSION=$(git describe --tags --always)
LDFLAGS="-s -w -X main.version=${VERSION}"

platforms=(
    "linux/amd64"
    "linux/arm64"
    "darwin/amd64"
    "darwin/arm64"
    "windows/amd64"
)

for platform in "${platforms[@]}"; do
    GOOS="${platform%/*}"
    GOARCH="${platform#*/}"
    output="${APP}-${GOOS}-${GOARCH}"
    [[ "$GOOS" == "windows" ]] && output="${output}.exe"

    echo "Building ${output}..."
    CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build \
        -ldflags "$LDFLAGS" -trimpath -o "dist/${output}" ./cmd/app
done
```

## Popular Packages

### Web Frameworks and Routers

| Package | Description |
|---------|-------------|
| `net/http` (stdlib) | Standard HTTP server, enhanced routing in Go 1.22+ |
| `github.com/go-chi/chi/v5` | Lightweight, idiomatic router, fully net/http compatible |
| `github.com/gin-gonic/gin` | High-performance web framework (48% usage in 2025) |
| `github.com/labstack/echo/v4` | Minimalist, extensible web framework |
| `github.com/gofiber/fiber/v2` | Express-inspired, built on fasthttp |
| `connectrpc.com/connect` | gRPC-compatible HTTP APIs |

### Database

| Package | Description |
|---------|-------------|
| `database/sql` (stdlib) | Standard database interface |
| `github.com/jackc/pgx/v5` | PostgreSQL driver and toolkit (preferred over lib/pq) |
| `github.com/jmoiron/sqlx` | Extensions to database/sql (StructScan, NamedExec) |
| `github.com/sqlc-dev/sqlc` | Generate type-safe Go from SQL |
| `gorm.io/gorm` | ORM with auto-migration, associations |
| `entgo.io/ent` | Entity framework with code generation |
| `github.com/mattn/go-sqlite3` | SQLite3 driver (CGO) |
| `modernc.org/sqlite` | SQLite3 driver (pure Go, no CGO) |

### Configuration and CLI

| Package | Description |
|---------|-------------|
| `github.com/spf13/cobra` | CLI application framework |
| `github.com/spf13/viper` | Configuration management (JSON, YAML, TOML, env) |
| `github.com/urfave/cli/v2` | Simple CLI framework |
| `github.com/caarlos0/env/v11` | Parse environment variables into structs |
| `github.com/joho/godotenv` | Load .env files |
| `github.com/knadh/koanf/v2` | Lighter alternative to viper |

### Logging and Observability

| Package | Description |
|---------|-------------|
| `log/slog` (stdlib, Go 1.21+) | Structured logging |
| `go.uber.org/zap` | High-performance structured logging |
| `github.com/rs/zerolog` | Zero-allocation JSON logger |
| `go.opentelemetry.io/otel` | OpenTelemetry tracing and metrics |
| `github.com/prometheus/client_golang` | Prometheus metrics |

### HTTP and Networking

| Package | Description |
|---------|-------------|
| `net/http` (stdlib) | HTTP client and server |
| `github.com/go-resty/resty/v2` | HTTP client with retry, middleware |
| `github.com/hashicorp/go-retryablehttp` | Retryable HTTP client |
| `google.golang.org/grpc` | gRPC framework |
| `nhooyr.io/websocket` | WebSocket library |

### Testing

| Package | Description |
|---------|-------------|
| `testing` (stdlib) | Standard testing framework |
| `github.com/stretchr/testify` | Assertions, mocks, suites |
| `github.com/google/go-cmp` | Deep comparison for tests |
| `go.uber.org/mock` | Interface mocking (mockgen) |
| `github.com/DATA-DOG/go-sqlmock` | SQL mock for database tests |
| `github.com/jarcoal/httpmock` | HTTP request mocking |

### Serialization

| Package | Description |
|---------|-------------|
| `encoding/json` (stdlib) | JSON (v2 in Go 1.25+) |
| `github.com/goccy/go-json` | Fast JSON (drop-in replacement) |
| `google.golang.org/protobuf` | Protocol Buffers |
| `gopkg.in/yaml.v3` | YAML parsing |
| `github.com/pelletier/go-toml/v2` | TOML parsing |

### Concurrency and Sync

| Package | Description |
|---------|-------------|
| `sync` (stdlib) | Mutex, WaitGroup, Once, Map |
| `golang.org/x/sync/errgroup` | Goroutine groups with error handling |
| `golang.org/x/sync/semaphore` | Weighted semaphore |
| `golang.org/x/sync/singleflight` | Deduplicate concurrent calls |

### Utilities

| Package | Description |
|---------|-------------|
| `github.com/google/uuid` | UUID generation |
| `github.com/samber/lo` | Lodash-style generic utilities |
| `golang.org/x/exp` | Experimental stdlib extensions |
| `github.com/cenkalti/backoff/v4` | Exponential backoff |
| `github.com/robfig/cron/v3` | Cron job scheduler |

## Project Layout

Standard Go project structure:

```
project/
  cmd/
    myapp/
      main.go           # Entry point
  internal/             # Private packages (not importable by others)
    server/
      server.go
    database/
      database.go
  pkg/                  # Public packages (importable by others)
    api/
      api.go
  go.mod
  go.sum
  Makefile
  .golangci.yml
```

For libraries:
```
library/
  library.go            # Package root
  library_test.go
  internal/             # Private helpers
    helper.go
  go.mod
  go.sum
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `GOPATH` | Workspace directory | `~/go` |
| `GOBIN` | Binary install directory | `$GOPATH/bin` |
| `GOPROXY` | Module proxy URL | `https://proxy.golang.org,direct` |
| `GOPRIVATE` | Private module patterns | (none) |
| `GONOSUMCHECK` | Skip checksum verification | (none) |
| `CGO_ENABLED` | Enable/disable CGO | `1` on native, `0` cross-compile |
| `GOOS` | Target operating system | Host OS |
| `GOARCH` | Target architecture | Host architecture |
| `GOFLAGS` | Default go command flags | (none) |
| `GOEXPERIMENT` | Experimental features | (none) |
| `GOMAXPROCS` | Max OS threads for goroutines | Number of CPUs |

```bash
# View all settings
go env

# View only changed settings (Go 1.23+)
go env -changed

# Set persistent env
go env -w GOPRIVATE=github.com/mycompany/*
go env -w GOPROXY=https://proxy.golang.org,direct

# Unset
go env -u GOPRIVATE
```
