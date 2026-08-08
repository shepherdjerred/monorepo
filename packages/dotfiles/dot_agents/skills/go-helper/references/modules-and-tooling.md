# Go modules and tooling

Read this when changing `go.mod`, `go.work`, toolchains, dependencies, golangci-lint, gopls, or project layout.

## Language and toolchain versions

The `go` directive is a strict minimum and controls language semantics. The `toolchain` directive suggests the toolchain for the main module. `GOTOOLCHAIN` selects bundled, PATH, or downloadable toolchain behavior.

Go 1.22 loop-variable semantics and Go 1.23 timer-channel semantics depend on the package or main module language version. Do not infer behavior only from the installed binary.

## Modules

Use `go mod tidy -diff` for a read-only consistency check. `go mod tidy` edits module files. `go mod download` can fetch and populate caches.

For major version 2 or later, the module path generally needs the matching `/vN` suffix.

`GOPRIVATE` sets private module patterns and commonly supplies defaults for `GONOPROXY` and `GONOSUMDB`. Configure the narrower variables when proxy and checksum policy differ. There is no `GONOSUMCHECK` variable.

## Workspaces

`go.work`, `go work use`, and `go work sync` coordinate local modules. Committing `go.work` is repository policy, not a universal rule. Use a workspace when modules are developed together; avoid it when it hides version requirements that downstream users need to resolve independently.

## Tool dependencies

Current Go supports tool directives in `go.mod`. Prefer a versioned tool dependency or official versioned installation guidance over executing a mutable script from a repository's default branch.

## golangci-lint v2

Use the repository-pinned release. Current v2 configuration nests linter settings under `linters.settings` and uses current exclusion paths. Do not copy v1 `linters-settings` or `issues.exclude-dirs` examples.

Available and default linter sets change by release. Link the current catalog instead of claiming a fixed count.

## gopls

Canonical setting names are short keys such as `gofumpt`, `analyses`, `semanticTokens`, `usePlaceholders`, and `directoryFilters`. Dotted names can be editor-specific aliases; do not describe an unsupported repository-level `.gopls.json` as canonical.

## Project layout

Go defines no mandatory `pkg/`, `internal/`, or `cmd/` tree. `internal` has enforced import visibility semantics; the others are conventions. Describe an example as one common layout, not the standard layout.

## Environment facts

Query target-specific values:

```bash
go env CGO_ENABLED GOOS GOARCH
```

Do not hard-code CGO or CPU defaults. Current `GOMAXPROCS` considers CPU count, affinity, and Linux cgroup quota and can update as limits change.

## Primary documentation

- [Go module reference](https://go.dev/doc/modules/gomod-ref)
- [Go module reference specification](https://go.dev/ref/mod)
- [Go toolchains](https://go.dev/doc/toolchain)
- [cmd/go](https://pkg.go.dev/cmd/go)
- [Go workspaces](https://go.dev/doc/tutorial/workspaces)
- [Managing dependencies](https://go.dev/doc/modules/managing-dependencies)
- [Module release workflow](https://go.dev/doc/modules/release-workflow)
- [golangci-lint changelog](https://golangci-lint.run/docs/product/changelog/)
- [golangci-lint configuration](https://golangci-lint.run/docs/configuration/file/)
- [golangci-lint linters](https://golangci-lint.run/docs/linters/)
- [gopls settings](https://go.dev/gopls/settings)
- [Delve usage](https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv.md)
