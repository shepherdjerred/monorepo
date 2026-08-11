# terraform-provider-asuswrt

Terraform/OpenTofu provider for [Asuswrt-Merlin](https://www.asuswrt-merlin.net/)
routers. It manages router configuration — stored as NVRAM key/value pairs —
through the router's HTTP API (`/login.cgi`, `/appGet.cgi`, `/apply.cgi`),
using the HashiCorp Terraform Plugin Framework.

The provider is **not published** to registry.terraform.io or
registry.opentofu.org. Its provider address is
`registry.opentofu.org/shepherdjerred/asuswrt`; install it locally (see below).

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.

## Resources and data sources

| Type                        | Kind        | Manages                                         |
| --------------------------- | ----------- | ----------------------------------------------- |
| `asuswrt_system`            | resource    | Hostname, timezone, NTP servers                 |
| `asuswrt_dhcp_static_lease` | resource    | Static DHCP leases (packed NVRAM format)        |
| `asuswrt_wireless_network`  | resource    | Per-band WiFi settings (SSID, auth, channel, …) |
| `asuswrt_port_forward`      | resource    | Port forwarding rules (packed NVRAM format)     |
| `asuswrt_nvram`             | resource    | Generic NVRAM key/value (escape hatch)          |
| `asuswrt_nvram`             | data source | Read-only NVRAM lookup                          |

## Provider configuration

```hcl
terraform {
  required_providers {
    asuswrt = {
      source = "shepherdjerred/asuswrt"
    }
  }
}

provider "asuswrt" {
  host     = "192.168.1.1"   # required: router hostname or IP
  username = "admin"          # required: admin username
  password = var.router_password # required, sensitive

  # optional:
  # https    = true            # use HTTPS (default false)
  # port     = 8443            # default 80 (HTTP) or 8443 (HTTPS)
  # insecure = true            # skip TLS certificate verification (default false)
}
```

A full working configuration covering every resource and the data source is in
[examples/provider/provider.tf](examples/provider/provider.tf).

## Build, test, lint

Standalone Go module (not a Bun workspace member). From
`packages/terraform-provider-asuswrt`:

```bash
make build      # go build -o terraform-provider-asuswrt
make test       # go test ./... -v (unit tests use a mock router server)
make lint       # golangci-lint run ./...
make fmt        # gofumpt + goimports

# Acceptance tests require a real router:
TF_ACC=1 ASUSWRT_HOST=192.168.1.1 ASUSWRT_USERNAME=admin ASUSWRT_PASSWORD=secret \
  make testacc
```

## Local installation

Two options for using the provider from a checkout:

**Filesystem mirror** — `make install` builds the binary and copies it to
`~/.terraform.d/plugins/registry.opentofu.org/shepherdjerred/asuswrt/0.1.0/<os>_<arch>/`,
after which `tofu init` resolves `shepherdjerred/asuswrt` normally.

**Dev override** — skip `init` entirely during development by pointing the CLI
at the build directory in `~/.tofurc` (or `~/.terraformrc`):

```hcl
provider_installation {
  dev_overrides {
    "registry.opentofu.org/shepherdjerred/asuswrt" = "/path/to/monorepo/packages/terraform-provider-asuswrt"
  }
  direct {}
}
```

Run `make build` after each change; `tofu plan`/`apply` pick up the fresh
binary directly. Pass `-debug` to the built binary to attach a debugger
(delve) via Terraform's provider debug protocol.

## Architecture

- `internal/client/` — HTTP client for the router's undocumented API, including
  the packed-NVRAM encoding used by DHCP leases and port forwards
  (`packed.go`) and service restart handling (`service.go`).
- `internal/provider/` — Plugin Framework provider, resources, and data
  sources; `mock_server_test.go` backs the unit tests so no router is needed.
