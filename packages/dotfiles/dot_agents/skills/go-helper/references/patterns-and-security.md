# Go patterns and security

Read this when handling errors, goroutines, HTTP, iterators, file paths, logging, cryptography, or vulnerability scanning.

## Error ownership

Wrap with `%w` only when callers should inspect the cause. Use `errors.Is` and `errors.As` rather than matching text. Do not ignore errors from I/O, cleanup, database closure, tracing, or serving.

## Goroutines and channels

The creator owns goroutine shutdown. Close a channel from the sending side when ownership is unambiguous. Use context cancellation for request-scoped work and bound worker pools.

## HTTP

Servers must check the returned error and distinguish expected shutdown from failure. Clients must close response bodies and check status before decoding. Apply timeouts at the correct request, transport, and server layers.

## Iterators

Iterator functions use `iter.Seq` or `Seq2`. Stop immediately when `yield` returns false. `maps` and `slices` expose helpers such as `All`, `Keys`, `Values`, `Collect`, and `Sorted`.

## Safe paths

`os.Root` confines supported operations beneath a root and prevents symlink-based escape. It is useful for archive extraction and untrusted relative paths, but callers must still bound file types, sizes, counts, and resource use.

## Randomness and HPKE

Use `crypto/rand` for secrets. `math/rand/v2` is non-cryptographic. `crypto/hpke` is a protocol implementation, not permission to invent a new encryption scheme; follow RFC and application protocol requirements.

## Logging

`log/slog` provides structured records, handlers, levels, groups, and context-aware logging. Use stable field names, keep cardinality bounded, and redact secrets.

## Vulnerabilities

`govulncheck` reports known vulnerabilities reachable from application call paths. It can scan source or binaries. Treat results as actionable dependency/code evidence while still reviewing deployment reachability and remediation.

## Current package corrections

`github.com/pkg/errors` is in maintenance mode; prefer standard-library error wrapping for new code. The former `nhooyr/websocket` project now lives at `coder/websocket`; verify migration and version requirements before changing a dependency.

## Primary documentation

- [Go specification](https://go.dev/ref/spec)
- [crypto/hpke](https://pkg.go.dev/crypto/hpke)
- [os](https://pkg.go.dev/os)
- [runtime](https://pkg.go.dev/runtime)
- [iter](https://pkg.go.dev/iter)
- [maps](https://pkg.go.dev/maps)
- [slices](https://pkg.go.dev/slices)
- [unique](https://pkg.go.dev/unique)
- [math/rand/v2](https://pkg.go.dev/math/rand/v2)
- [log/slog](https://pkg.go.dev/log/slog)
- [Go vulnerability management](https://go.dev/doc/security/vuln/)
- [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)
- [go vet](https://pkg.go.dev/cmd/vet)
