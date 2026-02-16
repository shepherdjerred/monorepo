---
name: go-helper
description: |
  Go development with modules, testing, linting, and common patterns
  When user works with .go files, mentions Go, golang, go modules, go test, or encounters Go compiler errors
---

# Go Helper Agent

## What's New in Go (2023-2026)

- **Go 1.26** (Feb 2026): `new()` accepts any expression (not just type names), Green Tea GC enabled by default (10-40% lower GC overhead), `crypto/hpke` package (HPKE RFC 9180), experimental `simd/archsimd` package (`GOEXPERIMENT=simd`), ~30% lower cgo call overhead, `cmd/doc` removed (use `go doc`), pprof opens flame graph by default
- **Go 1.25** (Aug 2025): Experimental Green Tea GC (10-40% lower GC overhead in heavy workloads), `encoding/json/v2` package with custom marshalers/unmarshalers, `testing/synctest` now stable, `runtime/trace.FlightRecorder` ring buffer API, DWARF v5 debug info (smaller binaries), cgroup CPU bandwidth-aware GOMAXPROCS on Linux
- **Go 1.24** (Feb 2025): Generic type aliases fully supported, `tool` directives in go.mod for executable dependencies, SwissTable map implementation (~30% faster large map access), `runtime.AddCleanup` replaces `SetFinalizer`, `os.Root` for directory-scoped filesystem ops, FIPS 140-3 compliance mechanisms, `go:wasmexport` directive, experimental `testing/synctest` package
- **Go 1.23** (Aug 2024): Range-over-function iterators (`range` accepts iterator functions), new `iter` package, new `unique` package for value interning, `slices`/`maps` iterator functions (`All`, `Values`, `Collect`), unbuffered timer channels (no stale values after Stop/Reset), `go vet` checks for too-new symbols, `go env -changed`, `go mod tidy -diff`
- **Go 1.22** (Feb 2024): Per-iteration for-loop variables (no more accidental sharing), `range` over integers, `net/http.ServeMux` supports methods and wildcards (`GET /task/{id}/`), `math/rand/v2`, `slices.Concat`, PGO devirtualization (2-14% improvement)
- **Go 1.21** (Aug 2023): Built-in `min`, `max`, `clear` functions, `log/slog` structured logging, `slices`/`maps`/`cmp` packages, `panic(nil)` now causes `*runtime.PanicNilError`, WASI Preview 1 support, PGO 2-7% improvements, GC tail latency up to 40% lower
- **Current stable**: 1.26.x (Feb 2026)

## Overview

This skill covers Go development using the go toolchain, testing (go test, table-driven tests, fuzzing, benchmarks), linting (go vet, golangci-lint), formatting (gofmt, goimports), debugging (delve, pprof), and the module system. It includes error handling, interfaces, generics, concurrency, context, iterators, and struct embedding patterns.

## CLI Commands

### Auto-Approved Safe Commands

```bash
# Check for issues
go vet ./...

# Format code
gofmt -l .
goimports -l .

# Build
go build ./...

# Run tests
go test ./...

# Show module dependencies
go list -m all

# Tidy module dependencies
go mod tidy

# Download dependencies
go mod download

# Show documentation
go doc fmt.Println

# Show environment
go env

# List available tools
go tool
```

### Build and Run

```bash
# Build current package
go build ./...

# Build specific package
go build ./cmd/myapp

# Build with output name
go build -o myapp ./cmd/myapp

# Build with race detector
go build -race ./cmd/myapp

# Build with build tags
go build -tags "integration,debug" ./...

# Build with linker flags (embed version info)
go build -ldflags "-X main.version=1.0.0 -X main.commit=$(git rev-parse HEAD)" ./cmd/myapp

# Build for production (strip debug info, smaller binary)
go build -ldflags "-s -w" -trimpath ./cmd/myapp

# Run directly
go run ./cmd/myapp
go run ./cmd/myapp -- --flag value

# Install binary to $GOPATH/bin
go install ./cmd/myapp

# Cross-compile
GOOS=linux GOARCH=amd64 go build -o myapp-linux ./cmd/myapp
GOOS=darwin GOARCH=arm64 go build -o myapp-darwin ./cmd/myapp
GOOS=windows GOARCH=amd64 go build -o myapp.exe ./cmd/myapp

# List supported platforms
go tool dist list
```

### Testing

```bash
# Run all tests
go test ./...

# Run with verbose output
go test -v ./...

# Run specific test function
go test -run TestMyFunction ./pkg/mypackage

# Run with race detector
go test -race ./...

# Run with coverage
go test -cover ./...
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out

# Run benchmarks
go test -bench=. ./...
go test -bench=BenchmarkMyFunc -benchmem ./...

# Run fuzz tests
go test -fuzz=FuzzMyFunc -fuzztime=30s ./...

# Run with timeout
go test -timeout 60s ./...

# Run short tests only
go test -short ./...

# Show test binary output
go test -v -count=1 ./...

# List tests without running
go test -list '.*' ./...

# Run tests single-threaded
go test -parallel 1 ./...
```

### Linting and Formatting

```bash
# Format code (write changes)
gofmt -w .
goimports -w .

# Check formatting without writing
gofmt -l .
goimports -l .

# Vet (built-in static analysis)
go vet ./...

# golangci-lint (meta-linter, 50+ linters)
golangci-lint run
golangci-lint run ./...
golangci-lint run --fix
golangci-lint run --enable errcheck,staticcheck,gosec

# golangci-lint v2 configuration (.golangci.yml)
# linters:
#   default: standard
#   enable:
#     - errcheck
#     - staticcheck
#     - gosec
#     - gocritic
#     - revive
```

### Modules

```bash
# Initialize new module
go mod init github.com/user/project

# Add dependency
go get github.com/pkg/errors
go get github.com/pkg/errors@v0.9.1
go get github.com/pkg/errors@latest

# Update all dependencies
go get -u ./...

# Update specific dependency
go get -u github.com/pkg/errors

# Remove unused dependencies
go mod tidy

# Vendor dependencies
go mod vendor

# Show dependency graph
go mod graph

# Verify dependencies
go mod verify

# Show why a module is needed
go mod why github.com/pkg/errors

# Edit go.mod
go mod edit -require github.com/pkg/errors@v0.9.1
go mod edit -replace github.com/old/pkg=github.com/new/pkg@v1.0.0
go mod edit -dropreplace github.com/old/pkg

# Workspaces (multi-module development)
go work init ./module-a ./module-b
go work use ./module-c
go work sync
```

### Tool Dependencies (Go 1.24+)

```bash
# Add tool dependency to go.mod
go get -tool golang.org/x/tools/cmd/stringer
go get -tool github.com/golangci/golangci-lint/v2/cmd/golangci-lint

# Run tool from go.mod
go tool stringer -type=MyType
go tool golangci-lint run

# List tool dependencies
go mod edit -json | jq '.Tool'
```

## Essential Patterns Quick Reference

### Error Handling

```go
// Return errors, don't panic
func readConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("reading config %s: %w", path, err)
    }
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parsing config: %w", err)
    }
    return &cfg, nil
}

// Sentinel errors
var ErrNotFound = errors.New("not found")
var ErrPermission = errors.New("permission denied")

// Check with errors.Is (works through wrapping)
if errors.Is(err, ErrNotFound) { /* handle */ }

// Extract with errors.As
var pathErr *os.PathError
if errors.As(err, &pathErr) { /* use pathErr.Path */ }
```

### Interfaces

```go
// Small, focused interfaces
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

// Compose interfaces
type ReadWriter interface {
    Reader
    Writer
}

// Accept interfaces, return structs
func Process(r io.Reader) (*Result, error) {
    data, err := io.ReadAll(r)
    if err != nil {
        return nil, err
    }
    return &Result{Data: data}, nil
}
```

### Generics (Go 1.18+)

```go
// Generic function
func Map[T, U any](s []T, f func(T) U) []U {
    result := make([]U, len(s))
    for i, v := range s {
        result[i] = f(v)
    }
    return result
}

// Generic type with constraint
type Number interface {
    ~int | ~int32 | ~int64 | ~float32 | ~float64
}

func Sum[T Number](nums []T) T {
    var total T
    for _, n := range nums {
        total += n
    }
    return total
}
```

### Iterators (Go 1.23+)

```go
// Push iterator (standard)
func All[T any](s []T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for _, v := range s {
            if !yield(v) {
                return
            }
        }
    }
}

// Key-value iterator
func Entries[K comparable, V any](m map[K]V) iter.Seq2[K, V] {
    return func(yield func(K, V) bool) {
        for k, v := range m {
            if !yield(k, v) {
                return
            }
        }
    }
}

// Use in range loop
for v := range All(mySlice) {
    fmt.Println(v)
}
```

### Concurrency

```go
// Goroutines with WaitGroup
var wg sync.WaitGroup
for _, url := range urls {
    wg.Add(1)
    go func() {
        defer wg.Done()
        fetch(url)
    }()
}
wg.Wait()

// errgroup for concurrent tasks with error handling
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

### Struct Embedding

```go
// Embedding promotes methods and fields
type Base struct {
    ID string
}

func (b *Base) Identify() string { return b.ID }

type Server struct {
    Base          // Embedded, not named
    Host string
    Port int
}

s := Server{Base: Base{ID: "srv-1"}, Host: "localhost", Port: 8080}
s.Identify() // Promoted from Base
```

## go.mod Quick Reference

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
)

require (
    // indirect dependencies managed by go mod tidy
    golang.org/x/sys v0.25.0 // indirect
)

// Local replacement (development)
replace github.com/my/lib => ../my-lib
```

## When to Ask for Help

Ask the user for clarification when:
- Error handling strategy needs deciding (sentinel vs custom types vs wrapping)
- Concurrency pattern choice is unclear (channels vs mutex vs errgroup)
- Interface design decisions are needed
- Module structure or workspace layout is unclear
- Performance vs readability tradeoffs exist
- Context propagation or cancellation patterns are complex

---

See `references/` for detailed guides:
- `patterns.md` - Error handling, interfaces, generics, concurrency, context, iterators, struct embedding, testing patterns
- `modules-tooling.md` - Go modules, workspaces, dependency management, golangci-lint, go vet, gopls, build tags, cross-compilation, popular packages
- `testing-debugging.md` - go test, table-driven tests, benchmarks, fuzzing, testify, delve debugger, profiling with pprof, race detector
