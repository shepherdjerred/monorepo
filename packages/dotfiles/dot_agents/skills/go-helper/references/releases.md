# Go release lifecycle

Read this when upgrading Go, adopting a newly added standard-library API, or evaluating a release performance claim.

## Current release

Go 1.26.5 is current stable as of 2026-08-03. Verify the patch release live before publishing a version claim. Read every release note between the module's current toolchain and the target.

Important boundaries:

- Go 1.21 made the `go` directive a strict minimum and added automatic toolchain switching.
- Go 1.22 changed loop-variable semantics according to package language version.
- Go 1.23 timer-channel semantics depend on the main module's language version.
- Go 1.24 added tool directives, generic aliases, `B.Loop`, and `os.Root`.
- Go 1.25 stabilized `testing/synctest`, added flight recording, and made `GOMAXPROCS` cgroup-aware.
- Go 1.26 enabled Green Tea GC by default and added `crypto/hpke`; JSON v2 remains experimental.

Performance figures in release notes are benchmark-dependent. Preserve attribution and workload rather than turning them into universal guarantees.

## Research ledger

The following 44 primary pages were fetched and inspected:

1. [Go 1.26 release notes](https://go.dev/doc/go1.26)
2. [Go 1.25 release notes](https://go.dev/doc/go1.25)
3. [Go 1.24 release notes](https://go.dev/doc/go1.24)
4. [Go 1.23 release notes](https://go.dev/doc/go1.23)
5. [Go 1.22 release notes](https://go.dev/doc/go1.22)
6. [Go 1.21 release notes](https://go.dev/doc/go1.21)
7. [Go release history](https://go.dev/doc/devel/release)
8. [Go specification](https://go.dev/ref/spec)
9. [Go module reference](https://go.dev/doc/modules/gomod-ref)
10. [Go module specification](https://go.dev/ref/mod)
11. [Go toolchains](https://go.dev/doc/toolchain)
12. [cmd/go](https://pkg.go.dev/cmd/go)
13. [testing](https://pkg.go.dev/testing)
14. [testing/synctest](https://pkg.go.dev/testing/synctest)
15. [runtime/trace](https://pkg.go.dev/runtime/trace)
16. [runtime/pprof](https://pkg.go.dev/runtime/pprof)
17. [net/http/pprof](https://pkg.go.dev/net/http/pprof)
18. [crypto/hpke](https://pkg.go.dev/crypto/hpke)
19. [encoding/json/v2](https://pkg.go.dev/encoding/json/v2)
20. [os](https://pkg.go.dev/os)
21. [runtime](https://pkg.go.dev/runtime)
22. [iter](https://pkg.go.dev/iter)
23. [maps](https://pkg.go.dev/maps)
24. [slices](https://pkg.go.dev/slices)
25. [unique](https://pkg.go.dev/unique)
26. [math/rand/v2](https://pkg.go.dev/math/rand/v2)
27. [log/slog](https://pkg.go.dev/log/slog)
28. [Go fuzzing](https://go.dev/doc/security/fuzz/)
29. [Race detector](https://go.dev/doc/articles/race_detector)
30. [PGO](https://go.dev/doc/pgo)
31. [GC guide](https://go.dev/doc/gc-guide)
32. [Go workspaces](https://go.dev/doc/tutorial/workspaces)
33. [Managing dependencies](https://go.dev/doc/modules/managing-dependencies)
34. [Module release workflow](https://go.dev/doc/modules/release-workflow)
35. [Go vulnerability management](https://go.dev/doc/security/vuln/)
36. [golangci-lint changelog](https://golangci-lint.run/docs/product/changelog/)
37. [golangci-lint configuration](https://golangci-lint.run/docs/configuration/file/)
38. [golangci-lint linters](https://golangci-lint.run/docs/linters/)
39. [gopls settings](https://go.dev/gopls/settings)
40. [Delve usage](https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv.md)
41. [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)
42. [go vet](https://pkg.go.dev/cmd/vet)
43. [pkg/errors README](https://github.com/pkg/errors/blob/master/README.md)
44. [coder/websocket README](https://github.com/coder/websocket/blob/master/README.md)
