---
name: go-helper
description: Current Go development guidance for modules, toolchains, workspaces, testing, fuzzing, concurrency, profiling, security, and Go tooling. Use when writing or reviewing Go, go.mod, go.work, Go CI, tests, performance work, or Go upgrades.
---

# Go Helper

Use the module's declared Go language version, propagate errors, keep goroutine ownership explicit, and run the repository's real verification commands. Distinguish read-only module checks from operations that edit files or fetch dependencies.

## Current baseline

Verified 2026-08-03: current stable is Go 1.26.5.

```bash
go version
go env GOTOOLCHAIN GOVERSION
```

Go 1.26 added expression-valued `new`, the default Green Tea garbage collector, lower cgo overhead, `crypto/hpke`, and other library/tool changes. JSON v2 remains experimental behind `GOEXPERIMENT=jsonv2`; SIMD work is experimental and platform-specific.

The `go` directive is a strict minimum language/toolchain version. `toolchain` suggests a toolchain for the main module. Module-version boundaries also control behavior such as Go 1.22 loop variables and Go 1.23 timer channels.

Read [references/releases.md](references/releases.md) for the 44-page research ledger. Read [references/modules-and-tooling.md](references/modules-and-tooling.md) for module, workspace, toolchain, lint, and dependency operations. Read [references/testing-and-performance.md](references/testing-and-performance.md) for tests, fuzzing, races, `synctest`, traces, profiles, and PGO. Read [references/patterns-and-security.md](references/patterns-and-security.md) for errors, goroutines, HTTP, paths, logging, randomness, and vulnerability checks.

## Command authority

Read-only or check-oriented commands:

```bash
go version
go env
go list ./...
go test ./...
go test -race ./...
go vet ./...
go mod verify
go mod tidy -diff
go work edit -json
```

`go mod tidy` edits `go.mod` and `go.sum`. Dependency and download commands can mutate caches and involve network state. Review their effect instead of labeling them read-only.

## Focused verification

Use the package's actual task when one exists. A generic Go project baseline is:

```bash
go test ./...
go test -race ./...
go vet ./...
go mod tidy -diff
```

Run the repository-pinned golangci-lint command if configured. Do not prescribe a fixed number of linters; its catalog and defaults are versioned.

## Modules and toolchains

```go.mod
module example.com/project

go 1.26
```

The `go` line is the minimum required version and selects language behavior. `GOTOOLCHAIN` controls whether the bundled, PATH, or downloadable toolchain is selected.

Use `go get` for dependency changes and `go mod tidy` to reconcile the module graph. Review both `go.mod` and `go.sum`. Avoid a broad `go get -u ./...`; upgrade an intentional set, read release notes, and verify the resulting graph.

For a non-mutating tidy check:

```bash
go mod tidy -diff
```

## Errors

Return errors with context and preserve identity with `%w` when callers may inspect them:

```go
func load(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %q: %w", path, err)
	}
	return data, nil
}
```

Do not discard `Close`, `ReadAll`, `Write`, trace, or server errors when failure can affect correctness. For cleanup whose error matters, call and return it explicitly rather than relying only on `defer`.

## Goroutine ownership

Every goroutine needs a lifecycle: completion, cancellation, or a process-long owner. Thread `context.Context` through request-scoped operations; never store it in a long-lived struct solely for convenience.

Prefer `errgroup` or an equivalent structured owner when sibling failure should cancel work. Bound concurrency and preserve output ordering when the contract requires it.

## Tests and benchmarks

Go 1.25 stabilized `testing/synctest`; the stable API is `synctest.Test(t, func(t *testing.T) { ... })` plus `synctest.Wait()`. Fake time advances only when goroutines in the bubble are durably blocked.

Use `B.Loop()` for current benchmarks. Avoid exact universal race-detector or benchmark overhead claims. The race detector only finds races executed on a supported platform.

Fuzz failures are stored at `testdata/fuzz/FuzzName/<hash>`. Keep them as regression corpus entries.

## Modern APIs

- Iterator functions and `iter.Seq` / `Seq2` support range-over-function patterns. Do not yield after `yield` returns false.
- `maps` and `slices` expose iterator-producing and consuming helpers.
- `unique.Make` canonicalizes comparable values into handles.
- `math/rand/v2` is non-cryptographic randomness.
- `os.Root` confines supported file operations against symlink path escapes.
- `runtime/trace.FlightRecorder` provides bounded recent trace data; check `Start` and `WriteTo` errors and call `Stop`.
- `crypto/hpke` implements RFC 9180, including hybrid post-quantum KEMs; use protocol-specific expertise before designing cryptography.

## HTTP and profiling

Check every server error. Bind diagnostic endpoints to an operator-only interface and never expose `net/http/pprof` unauthenticated to the public network.

Block and mutex profiles require nonzero profiling rates. CPU, heap, goroutine, block, and mutex profiles answer different questions.

Representative production CPU profiles can drive PGO through `default.pgo`. A profile must match the workload; do not treat PGO as a universal speed switch.

## Security

- Use `crypto/rand` for secrets; `math/rand/v2` is for non-security randomness.
- Use `os.Root` or equivalent confinement for untrusted relative paths.
- Keep private module configuration in `GOPRIVATE`, `GONOPROXY`, and `GONOSUMDB` as appropriate. `GONOSUMCHECK` does not exist.
- Run `govulncheck` for known vulnerabilities reachable from application call paths.
- Treat imported pprof handlers, cgo, templates, archive extraction, and subprocess arguments as security boundaries.
- Use structured `log/slog` fields and never log secrets.

## Review checklist

- Verify Go stable, the module `go` line, and selected toolchain.
- Use `go mod tidy -diff` for a non-writing module check.
- Review intentional dependency changes and both module files.
- Propagate meaningful errors, including cleanup and server failures.
- Give every goroutine an owner and cancellation path.
- Use exact tests, current `synctest`, correct fuzz corpus paths, and workload-qualified performance claims.
- Keep profiling endpoints private and check trace/profile errors.
- Use current golangci-lint v2 configuration and canonical gopls setting names.
- Separate experimental JSON v2 and SIMD behavior from stable defaults.
- Run `govulncheck` and use cryptographic randomness for secrets.
