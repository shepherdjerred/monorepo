# Tailscale Networking Reference

## Architecture Overview

Tailscale creates a mesh VPN (tailnet) where devices communicate directly via WireGuard tunnels. The coordination server handles peer discovery, key distribution, and ACL distribution, but never touches user data. All traffic flows point-to-point between devices using WireGuard encryption.

**IP Addressing:** Each device receives a stable IP from the CGNAT range `100.64.0.0/10` (100.64.0.0 - 100.127.255.255). These IPs persist across network changes, reboots, and location moves. The special address `100.100.100.100` (Quad100) provides access to Tailscale internal services.

**IPv6:** Each device also receives a Tailscale IPv6 address in the `fd7a:115c:a1e0::/48` range, derived from the node's public key.

## MagicDNS

MagicDNS automatically registers DNS names for all tailnet devices, eliminating the need for IP addresses.

### DNS Name Structure

Every device gets a fully qualified domain name:

```
<machine-name>.<tailnet-name>.ts.net
```

Example: `myserver.yak-bebop.ts.net`

Search domains are automatically configured, so short names work:

```bash
ssh user@myserver          # Short name works
ping myserver              # Resolves via search domain
curl http://myserver:8080  # Application access
```

### Configuration

Enable MagicDNS in the admin console under DNS settings. Enabled by default for tailnets created after October 2022. Requires Tailscale v1.20+ or at least one DNS nameserver configured.

### Split DNS

Route specific domain queries to designated nameservers while other queries use global resolvers. Configure in the admin console under DNS > Nameservers > Add Split DNS.

```
*.internal.company.com  ->  10.0.0.53 (internal DNS)
*.corp.example.com      ->  10.1.0.53 (corp DNS)
everything else         ->  1.1.1.1   (Cloudflare)
```

### Global Nameservers

Set global DNS resolvers for all tailnet devices. Tailscale automatically encrypts queries to public resolvers with DNS-over-HTTPS (DoH). Supports Cloudflare, Google, Quad9, NextDNS, and Control D.

### Override Local DNS

Force all devices to use tailnet DNS settings instead of local configuration. Enable "Override DNS servers" in admin console. Verify devices can reach the nameservers before enabling.

### Search Domains

Tailscale v1.34+ automatically appends search domain suffixes to incomplete hostnames. With MagicDNS enabled, the tailnet domain is the first search domain. Add custom search domains for internal name resolution.

### Limitations

- macOS CLI tools `host` and `nslookup` bypass system DNS and cannot resolve MagicDNS names; use `dig` or `tailscale dns query` instead
- Shared devices require full domain name and Tailscale v1.4+

## Subnet Routers

Subnet routers extend the tailnet to networks and devices that cannot run Tailscale directly. A device running Tailscale acts as a gateway, advertising routes to subnets it can reach.

### Setup (Linux)

1. Enable IP forwarding:

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

2. Advertise routes:

```bash
sudo tailscale set --advertise-routes=192.168.1.0/24,10.0.0.0/8
```

3. Approve routes in the admin console (Machines > device > Edit route settings) or use `autoApprovers` in the policy file.

4. Accept routes on client devices:

```bash
# Linux requires explicit opt-in
sudo tailscale set --accept-routes
```

macOS, Windows, Android, and iOS accept routes by default.

### SNAT Behavior

By default, traffic from the tailnet appears to originate from the subnet router's IP (SNAT). Disable to preserve source IPs:

```bash
# Linux only
sudo tailscale set --snat-subnet-routes=false
```

Disabling SNAT requires the target network to have routes back to the Tailscale subnet.

### High Availability

Run multiple subnet routers advertising the same routes for redundancy. Tailscale automatically fails over between routers. Avoid enabling `--accept-routes` on the subnet routers themselves if they advertise identical routes.

### 4via6 Subnet Routers

Handle overlapping IPv4 subnets by mapping them through site-specific IPv6 addresses. Assign unique site IDs to each location, and Tailscale generates non-overlapping IPv6 addresses for each subnet.

Use case: Multiple branch offices using the same `192.168.1.0/24` range.

### Longest Prefix Matching

When multiple routers advertise overlapping routes with different prefix lengths, traffic follows the most specific route:

- Router A: `10.0.0.0/16` -> catches broad traffic
- Router B: `10.0.1.0/24` -> catches specific subnet
- Traffic to `10.0.1.5` goes through Router B (more specific)
- Traffic to `10.0.2.5` goes through Router A (only match)

## Exit Nodes

Exit nodes route ALL internet traffic through a designated tailnet device, not just tailnet-bound traffic.

### Use Cases

- Secure internet access on untrusted networks (airports, hotels)
- Access geo-restricted services while traveling
- Comply with organizational VPN requirements
- Test applications from different geographic locations

### Server Setup

**Linux:**

```bash
# Enable IP forwarding
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf

# Advertise as exit node
sudo tailscale set --advertise-exit-node
```

Approve in the admin console (Machines > device > Edit route settings > "Use as exit node").

### Client Configuration

```bash
# Use specific exit node
sudo tailscale set --exit-node=<ip-or-hostname>

# Allow local LAN access while using exit node
sudo tailscale set --exit-node-allow-lan-access

# Use suggested exit node (nearest, lowest latency)
tailscale exit-node suggest

# List available exit nodes
tailscale exit-node list

# Stop using exit node
sudo tailscale set --exit-node=
```

### DNS with Exit Nodes

Configure DNS resolver behavior when using exit nodes. v1.90+ supports specifying DNS resolvers that work correctly through exit node routing.

### Mullvad Exit Nodes

Tailscale integrates with Mullvad VPN, providing commercial VPN exit nodes without separate Mullvad software. Enable Mullvad in the admin console, then select Mullvad exit nodes by country. Mullvad nodes appear in `tailscale exit-node list` output.

### Mandatory Exit Nodes

Force devices to always use an exit node via MDM/system policy. Useful for organizations requiring all traffic inspection.

## DERP Relay Servers

DERP (Designated Encrypted Relay for Packets) servers facilitate connectivity when direct WireGuard connections fail.

### How DERP Works

1. **Connection Establishment:** DERP servers relay encrypted handshake packets between devices during initial connection setup.
2. **Fallback Relay:** When NAT traversal fails (symmetric NAT, corporate firewalls), DERP relays encrypted WireGuard packets between peers.
3. **Zero Knowledge:** DERP servers handle already-encrypted packets and cannot decrypt user data. Private keys never leave devices.

### Geographic Distribution

Tailscale operates 20+ DERP regions globally:

- **Americas:** Multiple US cities (NYC, SFO, Chicago, Dallas, Miami, Denver, Seattle), Toronto, Sao Paulo
- **Europe:** London, Amsterdam, Frankfurt, Paris, Warsaw, Madrid, Helsinki, Nuremberg
- **Asia-Pacific:** Tokyo, Singapore, Hong Kong, Sydney, Bangalore
- **Africa/ME:** Nairobi, Johannesburg, Dubai

Most regions have 3+ servers for redundancy. Clients auto-select the nearest region.

### Custom DERP Servers

Self-host DERP relays by building the `cmd/derper` binary from the Tailscale repository. Configure custom DERP maps in the tailnet policy file:

```jsonc
{
  "derpMap": {
    "Regions": {
      "900": {
        "RegionID": 900,
        "RegionCode": "myderp",
        "RegionName": "My DERP",
        "Nodes": [
          {
            "Name": "myderp1",
            "RegionID": 900,
            "HostName": "derp.example.com",
          },
        ],
      },
    },
  },
}
```

Disable specific default regions by setting them to `null`:

```jsonc
{
  "derpMap": {
    "Regions": {
      "1": null, // Disable NYC region
    },
  },
}
```

### Peer Relays vs DERP

Peer Relays (beta, v1.86+) use existing tailnet nodes as relay servers instead of Tailscale-managed DERP infrastructure:

| Feature          | DERP             | Peer Relays        |
| ---------------- | ---------------- | ------------------ |
| **Managed by**   | Tailscale        | Customer           |
| **Throughput**   | Limited (shared) | Near-direct speed  |
| **Cost**         | Included         | Customer egress    |
| **Setup**        | Automatic        | Manual opt-in      |
| **Availability** | All plans        | All plans (2 free) |

Enable peer relay on a node:

```bash
tailscale set --advertise-peer-relay
```

Best for: locked-down cloud infrastructure, strict firewalls, high-bandwidth workloads.

## NAT Traversal

Tailscale uses multiple techniques to establish direct connections:

1. **STUN (Session Traversal Utilities for NAT):** Discovers public IP and port mapping via DERP-embedded STUN servers.
2. **UPnP / NAT-PMP / PCP:** Requests port mappings from compatible routers.
3. **Hard NAT Piercing:** Proprietary techniques for symmetric NAT environments.
4. **Birthday Paradox:** Port prediction using statistical methods for difficult NAT types.
5. **DERP Fallback:** When all direct methods fail, traffic flows through DERP relay.

Check NAT traversal status:

```bash
tailscale netcheck              # Full network report
tailscale ping --until-direct <peer>  # Wait for direct connection
tailscale status                # Shows direct vs relay per peer
```

`tailscale netcheck` output includes:

- UDP connectivity (v4/v6)
- Mapping type (endpoint independent, address dependent, etc.)
- Port mapping protocols available
- Nearest DERP region and latency
- IPv4/IPv6 support

## Tailscale in Docker

### Official Image

```bash
docker pull tailscale/tailscale:latest
# Tags: stable, latest, v1.94, v1.94.1, unstable
```

### Environment Variables

| Variable                        | Purpose                         | Default      |
| ------------------------------- | ------------------------------- | ------------ |
| `TS_AUTHKEY`                    | Auth key for registration       | -            |
| `TS_CLIENT_ID`                  | OAuth client ID                 | -            |
| `TS_CLIENT_SECRET`              | OAuth client secret             | -            |
| `TS_HOSTNAME`                   | Node hostname                   | container ID |
| `TS_STATE_DIR`                  | Persistent state directory      | -            |
| `TS_ROUTES`                     | Subnet routes to advertise      | -            |
| `TS_USERSPACE`                  | Userspace networking mode       | true         |
| `TS_ACCEPT_DNS`                 | Accept MagicDNS config          | false        |
| `TS_EXTRA_ARGS`                 | Additional `tailscale up` flags | -            |
| `TS_TAILSCALED_EXTRA_ARGS`      | Additional daemon flags         | -            |
| `TS_SOCKS5_SERVER`              | SOCKS5 proxy address            | -            |
| `TS_OUTBOUND_HTTP_PROXY_LISTEN` | HTTP proxy address              | -            |
| `TS_ENABLE_HEALTH_CHECK`        | Enable /healthz endpoint        | false        |
| `TS_ENABLE_METRICS`             | Enable /metrics endpoint        | false        |
| `TS_ID_TOKEN`                   | Workload identity JWT           | -            |
| `TS_AUDIENCE`                   | Workload identity audience      | -            |

### Docker Compose Example

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    hostname: my-app
    environment:
      - TS_AUTHKEY=tskey-auth-xxxxx
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_HOSTNAME=my-app
    volumes:
      - ts-state:/var/lib/tailscale
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    restart: unless-stopped

  app:
    image: nginx:latest
    network_mode: service:tailscale
    # App is accessible via Tailscale's network

volumes:
  ts-state:
```

### Sidecar Pattern

Use `network_mode: service:tailscale` to share the Tailscale network namespace with other containers. The app container inherits the Tailscale IP and can be reached via MagicDNS.

### Subnet Router in Docker

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    environment:
      - TS_AUTHKEY=tskey-auth-xxxxx
      - TS_ROUTES=192.168.1.0/24
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_USERSPACE=false
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    volumes:
      - ts-state:/var/lib/tailscale
      - /dev/net/tun:/dev/net/tun
    sysctls:
      - net.ipv4.ip_forward=1
```

## Tailscale on Kubernetes

### Kubernetes Operator

The Tailscale Kubernetes Operator manages Tailscale networking for K8s clusters.

**Installation prerequisites:**

1. Create OAuth client with scopes: `Devices Core`, `Auth Keys`, `Services` (write)
2. Add tags to policy: `tag:k8s-operator`, `tag:k8s`
3. Install via Helm or static manifests

**Helm installation:**

```bash
helm repo add tailscale https://pkgs.tailscale.com/helmcharts
helm repo update
helm upgrade --install tailscale-operator tailscale/tailscale-operator \
  --namespace=tailscale \
  --create-namespace \
  --set-string oauth.clientId=<CLIENT_ID> \
  --set-string oauth.clientSecret=<CLIENT_SECRET>
```

### Operator Capabilities

| Feature           | Description                                         |
| ----------------- | --------------------------------------------------- |
| **Ingress**       | Expose K8s services to tailnet via `Ingress` class  |
| **Egress**        | Access tailnet services from K8s via `ExternalName` |
| **API Proxy**     | Secure kubectl access through Tailscale             |
| **Subnet Router** | Advertise cluster CIDRs to tailnet                  |
| **Exit Node**     | Run exit node as K8s pod                            |
| **App Connector** | Connect SaaS apps through K8s                       |
| **ProxyGroup**    | Multi-replica HA proxy deployment                   |

### Ingress Example

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
spec:
  ingressClassName: tailscale
  rules:
    - host: my-app
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port:
                  number: 80
```

### Egress Example

```yaml
apiVersion: v1
kind: Service
metadata:
  name: tailnet-service
  annotations:
    tailscale.com/tailnet-fqdn: myserver.tailnet-name.ts.net
spec:
  type: ExternalName
  externalName: placeholder # Replaced by operator
```

### ProxyGroup for HA

Deploy multi-replica proxy groups (v1.76+) for zero-downtime updates:

```yaml
apiVersion: tailscale.com/v1alpha1
kind: ProxyGroup
metadata:
  name: my-proxy
spec:
  type: ingress
  replicas: 3
```

### Requirements

- Kubernetes v1.23.0+
- Operator and proxy versions should match (proxies may lag up to 4 minor versions)
- Most CNI configurations work; Cilium in kube-proxy replacement mode requires special configuration
- EKS Fargate: only Ingress and API proxy supported

## Tailscale Services

Tailscale Services (GA, Jan 2026) decouple applications from hosting devices:

- **Stable TailVIP:** Virtual IP independent of any physical device
- **MagicDNS name:** Stable DNS name for the service
- **Endpoints:** Define backend targets
- **Hosts:** Multiple devices can advertise the same service

Define services via the admin console or Tailscale API. Useful for:

- High-availability internal applications
- Ephemeral workloads (containers, serverless)
- Services with dynamic IP addresses
- Identity-aware proxies and MCP servers

## App Connectors

App connectors route traffic to SaaS applications through the tailnet, providing identity-aware access to cloud services without exposing them to the public internet.

### Setup

1. Tag a device as an app connector:

```bash
tailscale set --advertise-connector
```

2. Configure domains in the policy file:

```jsonc
{
  "nodeAttrs": [
    {
      "target": ["*"],
      "app": {
        "tailscale.com/app-connectors": [
          {
            "connectors": ["tag:connector"],
            "domains": ["*.salesforce.com", "*.amazonaws.com"],
          },
        ],
      },
    },
  ],
}
```

3. Traffic to matched domains automatically routes through the connector node.

### Preset Apps (v1.88+)

Pre-configured app connector profiles for common SaaS services:

- AWS Console and APIs
- Salesforce
- Microsoft 365
- GitHub Enterprise

## Tailscale on NAS Devices

### Synology

Install the Tailscale package from the Synology Package Center or sideload the SPK. Configure via:

```bash
tailscale configure synology
```

Supports subnet routing to expose NAS-connected networks to the tailnet.

### QNAP

Install via QNAP App Center. Supports standard Tailscale features including subnet routing and exit node functionality.

## Network Performance

### MTU Considerations

Tailscale uses WireGuard encapsulation which adds overhead. Default MTU is typically 1280 for IPv6 compatibility. Adjust if experiencing fragmentation:

- WireGuard overhead: 60-80 bytes
- Path MTU discovery is automatic
- Override with `TS_DEBUG_MTU` environment variable on the daemon

### Connection Types

| Type             | Latency | Throughput  | When Used                          |
| ---------------- | ------- | ----------- | ---------------------------------- |
| **Direct (UDP)** | Lowest  | Highest     | NAT traversal succeeds             |
| **Direct (TCP)** | Low     | High        | UDP blocked, TCP fallback          |
| **Peer Relay**   | Medium  | Near-direct | Direct fails, peer relay available |
| **DERP Relay**   | Higher  | Limited     | All direct methods fail            |

Check per-peer connection type with `tailscale status`. The "relay" column shows the DERP region if relayed, or "direct" for direct connections.

### Bandwidth

- Direct connections: limited only by the underlying network
- DERP relays: shared infrastructure with per-session limits
- Peer relays: limited by the relay node's bandwidth
- Funnel: subject to Tailscale-managed relay bandwidth limits

## Network Flow Logs

Monitor tailnet traffic with network flow logs. Enable log streaming in the admin console. v1.92+ automatically records node information in flow logs.

Flow logs capture:

- Source and destination devices
- Ports and protocols
- Connection timestamps
- Byte counts
- Connection type (direct/relay)

Configure log streaming destinations:

- Datadog
- Elastic
- Panther
- Cribl
- S3-compatible storage
- Generic webhook

Available on Enterprise plans.

## Tailscale on Cloud Providers

### AWS

Deploy Tailscale on EC2 instances as subnet routers to expose VPC networks:

```bash
# On EC2 instance
sudo tailscale set --advertise-routes=10.0.0.0/16 --advertise-exit-node
```

Use with AWS Systems Manager for automated deployment via cloud-init:

```yaml
#cloud-config
runcmd:
  - curl -fsSL https://tailscale.com/install.sh | sh
  - tailscale up --auth-key=tskey-auth-xxxxx --advertise-routes=10.0.0.0/16
```

### GCP / Azure

Same pattern as AWS. Install Tailscale on a VM, enable IP forwarding at the cloud provider level, and advertise subnet routes.

### Fly.io / Railway / Render

Use the Docker image with auth key for platform-as-a-service deployments. Ephemeral auth keys are recommended for auto-scaling environments.

## WireGuard Details

Tailscale builds on WireGuard for the data plane:

- **Protocol:** Noise protocol framework for key exchange
- **Encryption:** ChaCha20-Poly1305 for data, Curve25519 for key agreement
- **Port:** UDP port 41641 preferred; falls back to random ports or TCP relay
- **Key rotation:** Automatic node key rotation every 180 days (seamless in v1.90+)
- **Handshake:** Every 2 minutes to maintain NAT mappings

Unlike standalone WireGuard, Tailscale handles:

- Automatic key distribution via coordination server
- Dynamic peer discovery and configuration
- NAT traversal and relay fallback
- Access control enforcement
- DNS integration
