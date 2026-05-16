# terraform-provider-asuswrt

Custom OpenTofu provider for Asuswrt-Merlin routers. Standalone Go module (not a Bun workspace member).

## Build & Test

```bash
cd packages/terraform-provider-asuswrt

# Build
go build -o terraform-provider-asuswrt

# Unit tests
go test ./... -v

# Lint
golangci-lint run ./...

# Acceptance tests (real router required)
TF_ACC=1 ASUSWRT_HOST=192.168.1.1 ASUSWRT_USERNAME=admin ASUSWRT_PASSWORD=secret \
  go test ./internal/provider/... -v
```

## Architecture

- `internal/client/` — HTTP client wrapping router's undocumented API (`/login.cgi`, `/appGet.cgi`, `/apply.cgi`)
- `internal/provider/` — Terraform provider framework resources and data sources
- Router config stored as NVRAM key-value pairs, read/written via HTTP POST

## Resources

- `asuswrt_nvram` — Generic NVRAM key/value (escape hatch)
- `asuswrt_system` — Hostname, timezone, NTP
- `asuswrt_dhcp_static_lease` — Static DHCP leases (packed NVRAM format)
- `asuswrt_wireless_network` — Per-band WiFi settings
- `asuswrt_port_forward` — Port forwarding rules (packed NVRAM format)

## Data Sources

- `asuswrt_nvram` — Read-only NVRAM lookup
