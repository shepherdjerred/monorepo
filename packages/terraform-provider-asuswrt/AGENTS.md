# AsusWRT provider constraints

This standalone Go module implements an OpenTofu provider for Asuswrt-Merlin's
undocumented HTTP/NVRAM interfaces. It is not a Bun workspace.

- `internal/client` owns authentication, HTTP, and NVRAM encoding.
  `internal/provider` owns Plugin Framework resources and data sources.
- Preserve packed-list ordering and escaping for DHCP leases and port forwards.
- Treat the generic NVRAM resource as an escape hatch; typed resources own
  known validation and diff behavior.
- Never log router credentials or full sensitive NVRAM values.
- Unit tests do not prove router firmware compatibility. Acceptance tests use a
  real authorized router and may mutate it.

```bash
go build ./...
go test ./...
golangci-lint run ./...
```

Run `TF_ACC=1 go test ./internal/provider/...` only when live-router mutation is
explicitly in scope and credentials are already available.
