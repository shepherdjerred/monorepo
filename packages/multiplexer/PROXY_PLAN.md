# Auth Proxy Integration into Mux Daemon

## Goal
Extend the Mux daemon to run auth proxy services, so Docker containers have **zero credentials**. The Mux daemon manages proxy lifecycle and containers route through it.

---

## Phase 0: Integration Testing (BEFORE IMPLEMENTATION)

Validate each component works with minimal throwaway code before building the full solution.

### Test 1: Docker containers respect HTTPS_PROXY

**Question**: Do containers route traffic through a host proxy?

```bash
# Terminal 1: Start a simple logging proxy on host
mitmproxy --listen-port 18080 --mode regular

# Terminal 2: Run container with proxy env vars
docker run --rm -it \
  -e HTTP_PROXY=http://host.docker.internal:18080 \
  -e HTTPS_PROXY=http://host.docker.internal:18080 \
  alpine sh -c "apk add curl && curl -v https://api.github.com"
```

**Expected**: mitmproxy shows the request. If not, we have a fundamental problem.

**Fallback if fails**: Use `--network host` or iptables-based transparent proxy.

---

### Test 2: Header injection works

**Question**: Can we inject auth headers via proxy?

```python
# test_proxy.py - run on host with: python test_proxy.py
from mitmproxy import http

def request(flow: http.HTTPFlow):
    if "api.github.com" in flow.request.host:
        flow.request.headers["Authorization"] = "Bearer ghp_TESTTOKEN"
        print(f"Injected auth for {flow.request.host}")

# Run: mitmproxy -s test_proxy.py --listen-port 18080
```

```bash
# Container makes request, should see auth header injected
docker run --rm \
  -e HTTPS_PROXY=http://host.docker.internal:18080 \
  alpine sh -c "apk add curl && curl https://api.github.com/user"
```

**Expected**: Request succeeds if token is valid, or shows auth header in mitmproxy flow.

---

### Test 3: Container trusts custom CA

**Question**: Can containers trust our generated CA for HTTPS interception?

```bash
# Get mitmproxy's CA cert
cp ~/.mitmproxy/mitmproxy-ca-cert.pem /tmp/proxy-ca.pem

# Mount and trust it in container
docker run --rm \
  -e HTTPS_PROXY=http://host.docker.internal:18080 \
  -e SSL_CERT_FILE=/etc/ssl/proxy-ca.pem \
  -v /tmp/proxy-ca.pem:/etc/ssl/proxy-ca.pem:ro \
  python:3-slim python -c "import requests; print(requests.get('https://api.github.com').status_code)"
```

**Expected**: No SSL errors, request goes through proxy.

---

### Test 4: kubectl proxy works from container

**Question**: Can container use kubectl via host proxy?

```bash
# Terminal 1: Run kubectl proxy on host (uses your kubeconfig)
kubectl proxy --port=18081 --address=0.0.0.0 --accept-hosts='.*'

# Terminal 2: Create minimal kubeconfig for container
cat > /tmp/container-kubeconfig.yaml << 'EOF'
apiVersion: v1
kind: Config
clusters:
- cluster:
    server: http://host.docker.internal:18081
  name: proxied
contexts:
- context:
    cluster: proxied
  name: default
current-context: default
EOF

# Terminal 2: Test from container
docker run --rm \
  -v /tmp/container-kubeconfig.yaml:/etc/kube/config:ro \
  -e KUBECONFIG=/etc/kube/config \
  bitnami/kubectl get pods -A
```

**Expected**: Lists pods from your cluster without any credentials in the container.

---

### Test 5: Talos gRPC proxying (most complex)

**Question**: Can we proxy gRPC with mTLS termination?

```bash
# Option A: Test if talosctl respects HTTPS_PROXY at all
HTTPS_PROXY=http://localhost:18080 talosctl --nodes 10.0.0.1 version

# Check mitmproxy - does it see gRPC traffic?
```

If talosctl doesn't use the proxy for gRPC, we need the full gateway approach:

```bash
# Option B: Minimal gRPC proxy test with grpcurl
# Start a gRPC echo server, proxy through envoy/nginx, verify it works

# This validates the gateway architecture before building it
```

**Expected**: Understand if simple proxy works or if we need full mTLS gateway.

---

### Test 6: Claude Code in container uses proxy

**Question**: Does the actual Claude Code binary respect HTTPS_PROXY?

```bash
# Run Claude Code container with proxy
docker run --rm -it \
  -e HTTPS_PROXY=http://host.docker.internal:18080 \
  -e HTTP_PROXY=http://host.docker.internal:18080 \
  ghcr.io/shepherdjerred/dotfiles \
  bash -c "claude --version && curl -v https://api.anthropic.com/v1/messages"
```

**Expected**: See requests in mitmproxy, confirming Claude's HTTP client respects proxy.

---

### Test Matrix Summary

| Test | Component | Time | Pass Criteria |
|------|-----------|------|---------------|
| 1 | Docker + HTTPS_PROXY | 5 min | Traffic visible in mitmproxy |
| 2 | Header injection | 10 min | Auth header appears in request |
| 3 | Custom CA trust | 10 min | No SSL errors with mounted CA |
| 4 | kubectl proxy | 10 min | `kubectl get pods` works from container |
| 5 | Talos gRPC | 30 min | Determine if simple proxy or gateway needed |
| 6 | Claude Code | 10 min | Claude's requests go through proxy |

**Total validation time: ~1-2 hours**

### Go/No-Go Criteria

- **Tests 1-3 must pass** - Core proxy functionality
- **Test 4 must pass** - Kubernetes support
- **Test 5 determines scope** - If simple proxy works, less code. If not, need gateway.
- **Test 6 must pass** - The actual use case works

If any of 1-4 or 6 fail, we need to investigate alternative approaches before implementation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Mux Daemon (mux daemon)                      │
│                                                                      │
│  ┌────────────────┐                                                 │
│  │  Credentials   │                                                 │
│  │  ~/.secrets/   │                                                 │
│  │  ├─ github     │                                                 │
│  │  ├─ anthropic  │                                                 │
│  │  ├─ pagerduty  │                                                 │
│  │  ├─ sentry     │                                                 │
│  │  ├─ npm        │                                                 │
│  │  └─ docker     │                                                 │
│  └───────┬────────┘                                                 │
│          │                                                           │
│          ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Proxy Services                            │    │
│  │                                                              │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │    │
│  │  │ HTTP Auth Proxy │  │  kubectl proxy  │  │ Talos mTLS   │ │    │
│  │  │ 127.0.0.1:18080 │  │  127.0.0.1:18081│  │ GW :18082    │ │    │
│  │  └─────────────────┘  └─────────────────┘  └──────────────┘ │    │
│  │                                                              │    │
│  │  ┌─────────────────────────────────────────────────────────┐ │    │
│  │  │              Audit Logger → ~/.mux/audit.jsonl          │ │    │
│  │  └─────────────────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Existing Mux Components                      │   │
│  │  - Unix socket server (/tmp/mux.sock)                         │   │
│  │  - SessionManager                                             │   │
│  │  - DockerBackend (modified to use proxy)                      │   │
│  │  - SQLite store                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Docker Containers (zero credentials)             │   │
│  │                                                               │   │
│  │  ENV:                                                         │   │
│  │    HTTP_PROXY=http://host.docker.internal:18080               │   │
│  │    HTTPS_PROXY=http://host.docker.internal:18080              │   │
│  │    KUBECONFIG=/etc/mux/kube/config                            │   │
│  │    TALOSCONFIG=/etc/mux/talos/config                          │   │
│  │                                                               │   │
│  │  MOUNTED (read-only, generated by mux):                       │   │
│  │    /etc/ssl/certs/mux-proxy-ca.pem                            │   │
│  │    /etc/mux/kube/config    (server: host.docker.internal:18081)│   │
│  │    /etc/mux/talos/config   (endpoint: host.docker.internal:18082)│   │
│  │                                                               │   │
│  │  ❌ NO credentials, tokens, or client certificates           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Services Supported

| Service | Header | Format | Endpoint |
|---------|--------|--------|----------|
| **GitHub** | `Authorization` | `Bearer <token>` | api.github.com |
| **Claude/Anthropic** | `x-api-key` | `<key>` (raw, NOT Bearer) | api.anthropic.com |
| **PagerDuty** | `Authorization` | `Token token=<key>` | api.pagerduty.com |
| **Sentry** | `Authorization` | `Bearer <token>` | sentry.io |
| **npm registry** | `Authorization` | `Bearer <token>` | registry.npmjs.org |
| **Docker registry** | `Authorization` | `Bearer <token>` | registry-1.docker.io |
| **Kubernetes** | N/A | kubectl proxy | via :18081 |
| **Talos** | mTLS | Client certs via gateway | via :18082 |

## Files to Create/Modify

### New Files

```
packages/multiplexer/src/
├── proxy/
│   ├── mod.rs              # Module exports
│   ├── manager.rs          # ProxyManager - orchestrates all proxy services
│   ├── http_proxy.rs       # HTTPS MITM proxy with header injection
│   ├── k8s_proxy.rs        # kubectl proxy subprocess wrapper
│   ├── talos_gateway.rs    # Talos mTLS terminating gateway
│   ├── audit.rs            # JSON audit logger
│   ├── config.rs           # Proxy configuration and credentials
│   └── rules.rs            # Auth injection rules
```

### Modified Files

| File | Changes |
|------|---------|
| `src/main.rs` | Start proxy services when daemon starts |
| `src/backends/docker.rs` | Add proxy env vars and config mounts to containers |
| `Cargo.toml` | Add hyper, rustls, tonic, rcgen dependencies |

## Implementation Details

### 1. ProxyManager (`src/proxy/manager.rs`)

Lifecycle management for all proxy services:

```rust
pub struct ProxyManager {
    http_proxy: HttpAuthProxy,
    k8s_proxy: KubernetesProxy,
    talos_gateway: TalosGateway,
    audit_logger: AuditLogger,
}

impl ProxyManager {
    pub async fn start(&mut self) -> anyhow::Result<()>;
    pub async fn stop(&mut self) -> anyhow::Result<()>;
    pub fn is_healthy(&self) -> bool;
}
```

### 2. HTTP Auth Proxy (`src/proxy/http_proxy.rs`)

HTTPS MITM proxy using hyper + rustls:

```rust
const RULES: &[Rule] = &[
    Rule { host: "api.github.com", header: "Authorization", format: "Bearer {}", env: "GITHUB_TOKEN" },
    Rule { host: "api.anthropic.com", header: "x-api-key", format: "{}", env: "ANTHROPIC_API_KEY" },
    Rule { host: "api.pagerduty.com", header: "Authorization", format: "Token token={}", env: "PAGERDUTY_TOKEN" },
    Rule { host: "sentry.io", header: "Authorization", format: "Bearer {}", env: "SENTRY_AUTH_TOKEN" },
    Rule { host: "registry.npmjs.org", header: "Authorization", format: "Bearer {}", env: "NPM_TOKEN" },
    Rule { host: "registry-1.docker.io", header: "Authorization", format: "Bearer {}", env: "DOCKER_TOKEN" },
];
```

### 3. Kubernetes Proxy (`src/proxy/k8s_proxy.rs`)

Wraps kubectl proxy as subprocess:

```rust
pub struct KubernetesProxy {
    process: Option<Child>,
    port: u16,
}

impl KubernetesProxy {
    pub async fn start(&mut self) -> anyhow::Result<()> {
        self.process = Some(
            Command::new("kubectl")
                .args(["proxy", "--port", &self.port.to_string()])
                .spawn()?
        );
    }
}
```

### 4. Talos Gateway (`src/proxy/talos_gateway.rs`)

gRPC server that terminates mTLS:

```rust
pub struct TalosGateway {
    // Loaded from ~/.talos/config
    client_cert: Certificate,
    client_key: PrivateKey,
    ca_cert: Certificate,
    endpoints: Vec<String>,
}
```

### 5. Docker Backend Changes (`src/backends/docker.rs`)

Modify `build_create_args` to include proxy configuration:

```rust
pub fn build_create_args(...) -> Vec<String> {
    let mux_config_dir = format!("{home_dir}/.mux");

    vec![
        // ... existing args ...

        // Proxy environment variables
        "-e", "HTTP_PROXY=http://host.docker.internal:18080",
        "-e", "HTTPS_PROXY=http://host.docker.internal:18080",
        "-e", "NO_PROXY=localhost,127.0.0.1",

        // Trust proxy CA
        "-e", "NODE_EXTRA_CA_CERTS=/etc/mux/proxy-ca.pem",
        "-e", "SSL_CERT_FILE=/etc/mux/proxy-ca.pem",
        "-e", "REQUESTS_CA_BUNDLE=/etc/mux/proxy-ca.pem",

        // Kubeconfig pointing to proxy
        "-e", "KUBECONFIG=/etc/mux/kube/config",
        "-v", format!("{mux_config_dir}/kube:/etc/mux/kube:ro"),

        // Talosconfig pointing to gateway
        "-e", "TALOSCONFIG=/etc/mux/talos/config",
        "-v", format!("{mux_config_dir}/talos:/etc/mux/talos:ro"),

        // Proxy CA certificate
        "-v", format!("{mux_config_dir}/proxy-ca.pem:/etc/mux/proxy-ca.pem:ro"),

        // ... rest of args ...
    ]
}
```

### 6. Cargo.toml Additions

```toml
# HTTP proxy
hyper = { version = "1", features = ["full"] }
hyper-util = "0.1"
http-body-util = "0.1"

# TLS
rustls = "0.23"
tokio-rustls = "0.26"
rcgen = "0.13"                    # Generate proxy CA cert
rustls-pemfile = "2"

# gRPC (for Talos)
tonic = "0.12"
prost = "0.13"
```

## Detailed Task Breakdown

### Phase 0: Integration Testing (validate approach)

- [ ] **T0.1** Install mitmproxy on host: `pip install mitmproxy`
- [ ] **T0.2** Test 1: Run `mitmproxy --listen-port 18080`
- [ ] **T0.3** Test 1: Run alpine container with HTTPS_PROXY, verify traffic in mitmproxy
- [ ] **T0.4** Test 2: Create `test_proxy.py` with header injection addon
- [ ] **T0.5** Test 2: Run mitmproxy with addon, verify header injection works
- [ ] **T0.6** Test 3: Copy mitmproxy CA cert to `/tmp/proxy-ca.pem`
- [ ] **T0.7** Test 3: Run python container with SSL_CERT_FILE, verify no SSL errors
- [ ] **T0.8** Test 4: Run `kubectl proxy --port=18081 --address=0.0.0.0`
- [ ] **T0.9** Test 4: Create `/tmp/container-kubeconfig.yaml` pointing to host proxy
- [ ] **T0.10** Test 4: Run kubectl container with mounted kubeconfig, verify `get pods` works
- [ ] **T0.11** Test 5: Run `HTTPS_PROXY=... talosctl version`, check if gRPC uses proxy
- [ ] **T0.12** Test 5: Document findings - simple proxy vs full gateway needed
- [ ] **T0.13** Test 6: Run Claude Code container with HTTPS_PROXY, verify requests proxied
- [ ] **T0.14** Write up Go/No-Go decision based on test results

### Phase 1: Cargo.toml Dependencies

- [ ] **T1.1** Add `hyper = { version = "1", features = ["full"] }` to Cargo.toml
- [ ] **T1.2** Add `hyper-util = "0.1"` to Cargo.toml
- [ ] **T1.3** Add `http-body-util = "0.1"` to Cargo.toml
- [ ] **T1.4** Add `rustls = "0.23"` to Cargo.toml
- [ ] **T1.5** Add `tokio-rustls = "0.26"` to Cargo.toml
- [ ] **T1.6** Add `rcgen = "0.13"` to Cargo.toml
- [ ] **T1.7** Add `rustls-pemfile = "2"` to Cargo.toml
- [ ] **T1.8** Add `tonic = "0.12"` to Cargo.toml
- [ ] **T1.9** Add `prost = "0.13"` to Cargo.toml
- [ ] **T1.10** Run `cargo check` to verify dependencies resolve

### Phase 2: Proxy Module Skeleton

- [ ] **T2.1** Create directory `src/proxy/`
- [ ] **T2.2** Create `src/proxy/mod.rs` with module declarations
- [ ] **T2.3** Create empty `src/proxy/config.rs`
- [ ] **T2.4** Create empty `src/proxy/rules.rs`
- [ ] **T2.5** Create empty `src/proxy/audit.rs`
- [ ] **T2.6** Create empty `src/proxy/http_proxy.rs`
- [ ] **T2.7** Create empty `src/proxy/k8s_proxy.rs`
- [ ] **T2.8** Create empty `src/proxy/talos_gateway.rs`
- [ ] **T2.9** Create empty `src/proxy/manager.rs`
- [ ] **T2.10** Add `mod proxy;` to `src/main.rs`
- [ ] **T2.11** Run `cargo check` to verify module structure compiles

### Phase 3: Configuration & Credentials

- [ ] **T3.1** Define `ProxyConfig` struct in `src/proxy/config.rs`
- [ ] **T3.2** Add `secrets_dir: PathBuf` field to ProxyConfig
- [ ] **T3.3** Add `http_proxy_port: u16` field (default 18080)
- [ ] **T3.4** Add `k8s_proxy_port: u16` field (default 18081)
- [ ] **T3.5** Add `talos_gateway_port: u16` field (default 18082)
- [ ] **T3.6** Implement `ProxyConfig::load()` to read from `~/.mux/proxy.toml`
- [ ] **T3.7** Implement `ProxyConfig::default()` with sensible defaults
- [ ] **T3.8** Define `Credentials` struct with Optional fields for each service
- [ ] **T3.9** Implement `Credentials::load_from_env()` - read from env vars
- [ ] **T3.10** Implement `Credentials::load_from_files()` - read from `~/.secrets/`
- [ ] **T3.11** Implement `Credentials::load()` - try env first, then files
- [ ] **T3.12** Add unit test: credentials loaded from env vars
- [ ] **T3.13** Add unit test: credentials loaded from files
- [ ] **T3.14** Run `cargo test` to verify config tests pass

### Phase 4: Proxy CA Certificate Generation

- [ ] **T4.1** Create `src/proxy/ca.rs`
- [ ] **T4.2** Add `mod ca;` to `src/proxy/mod.rs`
- [ ] **T4.3** Implement `generate_ca()` using rcgen to create CA cert+key
- [ ] **T4.4** Implement `load_or_generate_ca()` - load from `~/.mux/proxy-ca.pem` or generate
- [ ] **T4.5** Implement `save_ca()` - write CA cert+key to disk
- [ ] **T4.6** Implement `generate_cert_for_host()` - create cert for specific hostname
- [ ] **T4.7** Add unit test: CA generation produces valid certificate
- [ ] **T4.8** Add unit test: generated host cert is signed by CA
- [ ] **T4.9** Run `cargo test` to verify CA tests pass

### Phase 5: Audit Logger

- [ ] **T5.1** Define `AuditEntry` struct in `src/proxy/audit.rs`
- [ ] **T5.2** Add fields: timestamp, service, method, path, auth_injected, response_code, duration_ms
- [ ] **T5.3** Derive `Serialize` for AuditEntry
- [ ] **T5.4** Define `AuditLogger` struct with file handle
- [ ] **T5.5** Implement `AuditLogger::new()` - open `~/.mux/audit.jsonl` for append
- [ ] **T5.6** Implement `AuditLogger::log()` - write JSON line
- [ ] **T5.7** Implement `AuditLogger::flush()` - ensure writes persisted
- [ ] **T5.8** Add unit test: log entry serializes correctly
- [ ] **T5.9** Add integration test: entries written to file
- [ ] **T5.10** Run `cargo test` to verify audit tests pass

### Phase 6: Auth Injection Rules

- [ ] **T6.1** Define `Rule` struct in `src/proxy/rules.rs`
- [ ] **T6.2** Add fields: host_pattern, header_name, format, env_var
- [ ] **T6.3** Define `const RULES: &[Rule]` with GitHub rule
- [ ] **T6.4** Add Anthropic rule (x-api-key, NOT Authorization)
- [ ] **T6.5** Add PagerDuty rule (Token token={} format)
- [ ] **T6.6** Add Sentry rule
- [ ] **T6.7** Add npm registry rule
- [ ] **T6.8** Add Docker Hub rule (registry-1.docker.io)
- [ ] **T6.9** Add Docker auth rule (auth.docker.io)
- [ ] **T6.10** Implement `Rule::matches()` - check if host matches pattern
- [ ] **T6.11** Implement `Rule::format_header()` - format credential into header value
- [ ] **T6.12** Implement `find_matching_rule()` - find rule for given host
- [ ] **T6.13** Add unit test: GitHub host matches GitHub rule
- [ ] **T6.14** Add unit test: api.anthropic.com uses x-api-key header
- [ ] **T6.15** Add unit test: PagerDuty formats as "Token token=..."
- [ ] **T6.16** Add unit test: unknown host returns None
- [ ] **T6.17** Run `cargo test` to verify rules tests pass

### Phase 7: HTTP Auth Proxy Core

- [ ] **T7.1** Define `HttpAuthProxy` struct in `src/proxy/http_proxy.rs`
- [ ] **T7.2** Add fields: listener, ca, credentials, audit_logger
- [ ] **T7.3** Implement `HttpAuthProxy::new()` - bind to 127.0.0.1:port
- [ ] **T7.4** Implement `HttpAuthProxy::run()` - accept loop
- [ ] **T7.5** Implement `handle_connection()` - dispatch based on request type
- [ ] **T7.6** Implement `handle_connect()` - HTTPS CONNECT tunnel setup
- [ ] **T7.7** Implement `tls_accept()` - accept TLS with generated cert
- [ ] **T7.8** Implement `proxy_request()` - forward request to upstream
- [ ] **T7.9** Implement `inject_auth()` - add auth header based on rules
- [ ] **T7.10** Implement `connect_upstream()` - establish TLS to real server
- [ ] **T7.11** Implement `copy_bidirectional()` - proxy bytes both directions
- [ ] **T7.12** Add tracing spans for request lifecycle
- [ ] **T7.13** Call audit_logger.log() for each proxied request
- [ ] **T7.14** Add unit test: CONNECT request parsed correctly
- [ ] **T7.15** Add integration test: proxy starts and accepts connection
- [ ] **T7.16** Run `cargo test` to verify http_proxy tests pass

### Phase 8: kubectl Proxy Wrapper

- [ ] **T8.1** Define `KubernetesProxy` struct in `src/proxy/k8s_proxy.rs`
- [ ] **T8.2** Add fields: process (Option<Child>), port
- [ ] **T8.3** Implement `KubernetesProxy::new()` - store port config
- [ ] **T8.4** Implement `KubernetesProxy::start()` - spawn kubectl proxy subprocess
- [ ] **T8.5** Add args: `["proxy", "--port", port, "--address", "127.0.0.1"]`
- [ ] **T8.6** Implement `KubernetesProxy::stop()` - kill subprocess
- [ ] **T8.7** Implement `KubernetesProxy::is_running()` - check process alive
- [ ] **T8.8** Implement `KubernetesProxy::health_check()` - HTTP GET to /healthz
- [ ] **T8.9** Implement `KubernetesProxy::restart_if_dead()` - auto-restart
- [ ] **T8.10** Add unit test: start spawns process
- [ ] **T8.11** Add unit test: stop kills process
- [ ] **T8.12** Run `cargo test` to verify k8s_proxy tests pass

### Phase 9: Container Config Generation

- [ ] **T9.1** Create `src/proxy/container_config.rs`
- [ ] **T9.2** Add `mod container_config;` to `src/proxy/mod.rs`
- [ ] **T9.3** Implement `generate_kubeconfig()` - create YAML pointing to k8s proxy
- [ ] **T9.4** Implement `generate_talosconfig()` - create YAML pointing to talos gateway
- [ ] **T9.5** Implement `write_container_configs()` - write to `~/.mux/kube/` and `~/.mux/talos/`
- [ ] **T9.6** Ensure parent directories created with proper permissions
- [ ] **T9.7** Add unit test: kubeconfig YAML is valid
- [ ] **T9.8** Add unit test: talosconfig YAML is valid
- [ ] **T9.9** Run `cargo test` to verify container_config tests pass

### Phase 10: Talos mTLS Gateway

- [ ] **T10.1** Define `TalosGateway` struct in `src/proxy/talos_gateway.rs`
- [ ] **T10.2** Add fields: client_cert, client_key, ca_cert, endpoints
- [ ] **T10.3** Implement `TalosGateway::load_talosconfig()` - parse `~/.talos/config`
- [ ] **T10.4** Extract client certificate from talosconfig
- [ ] **T10.5** Extract client key from talosconfig
- [ ] **T10.6** Extract CA certificate from talosconfig
- [ ] **T10.7** Extract endpoints list from talosconfig
- [ ] **T10.8** Implement `TalosGateway::new()` - load config and bind port
- [ ] **T10.9** Implement `TalosGateway::run()` - gRPC server accept loop
- [ ] **T10.10** Implement `create_mtls_client()` - rustls config with client cert
- [ ] **T10.11** Implement `proxy_grpc_call()` - forward gRPC to real Talos node
- [ ] **T10.12** Implement bidirectional stream proxying for gRPC
- [ ] **T10.13** Add tracing for proxied Talos calls
- [ ] **T10.14** Add unit test: talosconfig parsing extracts certs
- [ ] **T10.15** Add unit test: mTLS client config created correctly
- [ ] **T10.16** Run `cargo test` to verify talos_gateway tests pass

### Phase 11: Proxy Manager

- [ ] **T11.1** Define `ProxyManager` struct in `src/proxy/manager.rs`
- [ ] **T11.2** Add fields: config, http_proxy, k8s_proxy, talos_gateway, audit_logger
- [ ] **T11.3** Implement `ProxyManager::new()` - create all components
- [ ] **T11.4** Implement `ProxyManager::start()` - start all proxy services
- [ ] **T11.5** Start http_proxy in tokio task
- [ ] **T11.6** Start k8s_proxy subprocess
- [ ] **T11.7** Start talos_gateway in tokio task
- [ ] **T11.8** Implement `ProxyManager::stop()` - graceful shutdown all services
- [ ] **T11.9** Implement `ProxyManager::is_healthy()` - check all services running
- [ ] **T11.10** Implement `ProxyManager::generate_container_configs()` - call container_config
- [ ] **T11.11** Add unit test: manager starts all services
- [ ] **T11.12** Add unit test: manager stops all services
- [ ] **T11.13** Run `cargo test` to verify manager tests pass

### Phase 12: Docker Backend Integration

- [ ] **T12.1** Add `proxy_enabled: bool` parameter to `DockerBackend::build_create_args()`
- [ ] **T12.2** Add `-e HTTP_PROXY=http://host.docker.internal:18080` when enabled
- [ ] **T12.3** Add `-e HTTPS_PROXY=http://host.docker.internal:18080` when enabled
- [ ] **T12.4** Add `-e NO_PROXY=localhost,127.0.0.1` when enabled
- [ ] **T12.5** Add `-e NODE_EXTRA_CA_CERTS=/etc/mux/proxy-ca.pem` when enabled
- [ ] **T12.6** Add `-e SSL_CERT_FILE=/etc/mux/proxy-ca.pem` when enabled
- [ ] **T12.7** Add `-e REQUESTS_CA_BUNDLE=/etc/mux/proxy-ca.pem` when enabled
- [ ] **T12.8** Add `-e KUBECONFIG=/etc/mux/kube/config` when enabled
- [ ] **T12.9** Add `-e TALOSCONFIG=/etc/mux/talos/config` when enabled
- [ ] **T12.10** Add `-v ~/.mux/proxy-ca.pem:/etc/mux/proxy-ca.pem:ro` when enabled
- [ ] **T12.11** Add `-v ~/.mux/kube:/etc/mux/kube:ro` when enabled
- [ ] **T12.12** Add `-v ~/.mux/talos:/etc/mux/talos:ro` when enabled
- [ ] **T12.13** Update `DockerBackend::create()` to pass proxy_enabled
- [ ] **T12.14** Add unit test: proxy args included when enabled
- [ ] **T12.15** Add unit test: proxy args NOT included when disabled
- [ ] **T12.16** Add unit test: all required env vars present
- [ ] **T12.17** Add unit test: all required volume mounts present
- [ ] **T12.18** Run `cargo test` to verify docker backend tests pass

### Phase 13: Daemon Integration

- [ ] **T13.1** Add `proxy_manager: Option<ProxyManager>` field to daemon state
- [ ] **T13.2** In daemon startup, create ProxyManager with loaded config
- [ ] **T13.3** Call `proxy_manager.generate_container_configs()` on startup
- [ ] **T13.4** Call `proxy_manager.start()` before starting API server
- [ ] **T13.5** Add health check endpoint `/proxy/health` to API
- [ ] **T13.6** Call `proxy_manager.stop()` in daemon shutdown handler
- [ ] **T13.7** Add `--no-proxy` CLI flag to disable proxy services
- [ ] **T13.8** Log proxy service startup/shutdown events
- [ ] **T13.9** Add integration test: daemon starts with proxy services
- [ ] **T13.10** Add integration test: daemon stops proxy services on shutdown
- [ ] **T13.11** Run full `cargo test` to verify all tests pass

### Phase 14: Documentation & Cleanup

- [ ] **T14.1** Add rustdoc comments to all public functions
- [ ] **T14.2** Add rustdoc comments to all public structs
- [ ] **T14.3** Update README.md with proxy configuration section
- [ ] **T14.4** Document `~/.secrets/` credential file format
- [ ] **T14.5** Document `~/.mux/proxy.toml` config file format
- [ ] **T14.6** Run `cargo clippy` and fix all warnings
- [ ] **T14.7** Run `cargo fmt` to format all code
- [ ] **T14.8** Run `cargo test` one final time
- [ ] **T14.9** Manual end-to-end test: create session, verify no creds in container

---

**Total tasks: 148**
- Phase 0 (Testing): 14 tasks
- Phase 1-2 (Setup): 21 tasks
- Phase 3-6 (Config/Rules): 35 tasks
- Phase 7-10 (Proxy components): 44 tasks
- Phase 11-13 (Integration): 25 tasks
- Phase 14 (Docs): 9 tasks

## Security Considerations

1. **Proxy binds to localhost only** (127.0.0.1) - containers reach via `host.docker.internal`
2. **Credentials stored with 600 permissions** in `~/.secrets/`
3. **Proxy CA is ephemeral** - generated on daemon start, containers trust it via mount
4. **Audit log captures all proxied requests** - who accessed what, when
5. **Never log actual tokens** - only log that auth was injected

## Testing Strategy

1. Unit tests for rule matching and header formatting
2. Integration tests with mock HTTP server
3. Docker backend tests verify correct args generated
4. Manual testing with real services

## Sources
- [GitHub REST API Authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)
- [Anthropic API Docs](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [PagerDuty API Authentication](https://developer.pagerduty.com/docs/ZG9jOjExMDI5NTUx-authentication)
- [Sentry API Authentication](https://docs.sentry.io/api/auth/)
- [npm Registry Auth](https://docs.npmjs.com/using-private-packages-in-a-ci-cd-workflow/)
- [Docker Registry Auth](https://docs.docker.com/reference/api/registry/auth/)
- [Kubernetes Authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/)
- [Talos mTLS](https://www.talos.dev/)
