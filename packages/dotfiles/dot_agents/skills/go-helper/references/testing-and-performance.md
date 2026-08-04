# Go testing and performance

Read this when writing tests, fuzzing, using the race detector or `synctest`, collecting traces/profiles, tuning GC, or adopting PGO.

## Tests and cleanup

Use table tests when cases share a contract. Cleanup runs in last-in-first-out order. Register cleanup only after setup succeeds, and surface cleanup errors that can invalidate the test.

## Benchmarks

Current Go prefers `B.Loop()`:

```go
func BenchmarkEncode(b *testing.B) {
	for b.Loop() {
		encode(testValue)
	}
}
```

Benchmark results need stable inputs, environment context, and statistical comparison. Do not quote a speedup without the exact workload.

## Fuzzing

Fuzz targets add seeds and exercise generated inputs. A failing input is written directly to:

```text
testdata/fuzz/FuzzParseJSON/<hash>
```

There are no required `corpus/` or `seed/` subdirectories. Preserve useful failures as regression cases.

## Race detector

`go test -race` detects only races executed in that run and only on supported platforms. Overhead is workload-dependent. Run it on representative tests rather than claiming no false positives or a fixed cost.

## synctest

Stable Go 1.25+ usage:

```go
func TestTimeout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// start goroutines and advance only after durable blocking
		synctest.Wait()
	})
}
```

Do not use the removed experimental `synctest.Run` API.

## Profiles and traces

`runtime/pprof` supports CPU, heap, goroutine, block, and mutex profiles. Block and mutex profiles require enabling nonzero rates.

Importing `net/http/pprof` registers handlers. Bind them to localhost or a protected operator interface and check `ListenAndServe` errors.

Flight recorder lifecycle:

1. Check `Start()`.
2. Trigger and check `WriteTo()`.
3. Call `Stop()`.

## PGO and GC

Go automatically uses `default.pgo` when present. Use a representative production CPU profile. GC tuning through `GOGC` and memory limits is workload-specific; current Go 1.26 defaults to Green Tea GC.

## Primary documentation

- [testing](https://pkg.go.dev/testing)
- [testing/synctest](https://pkg.go.dev/testing/synctest)
- [runtime/trace](https://pkg.go.dev/runtime/trace)
- [runtime/pprof](https://pkg.go.dev/runtime/pprof)
- [net/http/pprof](https://pkg.go.dev/net/http/pprof)
- [Go fuzzing](https://go.dev/doc/security/fuzz/)
- [Race detector](https://go.dev/doc/articles/race_detector)
- [PGO](https://go.dev/doc/pgo)
- [GC guide](https://go.dev/doc/gc-guide)
