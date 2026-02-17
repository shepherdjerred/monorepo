# Tailscale ACLs, Security & Administration Reference

## Policy File Overview

The tailnet policy file controls all access in a Tailscale network. Written in huJSON (human JSON) format, which allows comments (`//` and `/* */`) and trailing commas. Edit via the admin console (Access Controls) or the Tailscale API.

**Default behavior:** Without a policy file, Tailscale allows all-to-all communication. Once a policy file exists, it enforces deny-by-default for all traffic.

## ACL Rules

### Basic Structure

```jsonc
{
  "acls": [
    {
      "action": "accept", // Only "accept" supported (deny is default)
      "src": ["source1", "source2"],
      "dst": ["dest1:port", "dest2:port"],
      "proto": "", // Optional: protocol filter
    },
  ],
}
```

### Source Identifiers

| Type       | Example                        | Description                   |
| ---------- | ------------------------------ | ----------------------------- |
| User       | `"user@example.com"`           | Specific user account         |
| Group      | `"group:engineering"`          | Named user group              |
| Tag        | `"tag:server"`                 | Tagged devices                |
| Autogroup  | `"autogroup:member"`           | Dynamic built-in groups       |
| IP/CIDR    | `"100.64.0.1"`, `"10.0.0.0/8"` | Specific addresses            |
| Host alias | `"myserver"`                   | Named host from hosts section |
| IP set     | `"ipset:servers"`              | Named IP collection           |

### Destination Format

Destinations combine a target with port specifications:

```
"target:ports"
```

Port formats:

- `*` - All ports
- `80` - Single port
- `80,443` - Multiple ports
- `1000-2000` - Port range
- `80,443,8000-9000` - Combined

### Protocol Filter

Restrict ACL rules to specific protocols:

```jsonc
{
  "action": "accept",
  "src": ["group:monitoring"],
  "proto": "icmp", // ICMP only
  "dst": ["tag:server:*"],
}
```

Supported protocols: `tcp`, `udp`, `icmp`, or numeric protocol numbers (6=TCP, 17=UDP, 1=ICMP).

### Autogroups

Built-in dynamic groups:

- `autogroup:member` - All human users in the tailnet
- `autogroup:admin` - Tailnet administrators
- `autogroup:owner` - Tailnet owners
- `autogroup:tagged` - All tagged devices
- `autogroup:internet` - Traffic destined for the internet (exit node use)
- `autogroup:self` - The device's own traffic
- `autogroup:danger-all` - Everything including shared-in devices (use carefully)

### ACL Examples

```jsonc
{
  "acls": [
    // Allow engineering team full access to servers
    {
      "action": "accept",
      "src": ["group:engineering"],
      "dst": ["tag:server:*"],
    },

    // Allow web traffic to web servers
    {
      "action": "accept",
      "src": ["autogroup:member"],
      "dst": ["tag:web:80,443"],
    },

    // Allow monitoring ICMP pings
    {
      "action": "accept",
      "src": ["group:ops"],
      "proto": "icmp",
      "dst": ["tag:server:*"],
    },

    // Allow database access on specific port
    { "action": "accept", "src": ["tag:app"], "dst": ["tag:db:5432"] },

    // Allow exit node usage
    {
      "action": "accept",
      "src": ["group:remote"],
      "dst": ["autogroup:internet:*"],
    },

    // Allow specific subnet access
    {
      "action": "accept",
      "src": ["group:office"],
      "dst": ["192.168.1.0/24:*"],
    },
  ],
}
```

## Grants (Recommended)

Grants are the modern replacement for ACLs, combining network-layer and application-layer access control. Grants support all ACL functionality plus additional capabilities like identity headers and app-level permissions.

### Grant Structure

```jsonc
{
  "grants": [
    {
      "src": ["group:engineering"],
      "dst": ["tag:server"],
      "ip": ["*"], // Network access (port/protocol)
      "app": {
        // Application-layer capabilities
        "tailscale.com/cap/ssh": [
          {
            "users": ["root", "deploy"],
          },
        ],
      },
    },
  ],
}
```

### Grant vs ACL Comparison

| Feature          | ACLs                   | Grants               |
| ---------------- | ---------------------- | -------------------- |
| Network access   | Yes                    | Yes (`ip` field)     |
| SSH access       | Separate `ssh` section | Inline (`app` field) |
| App capabilities | No                     | Yes (`app` field)    |
| Identity headers | No                     | Yes                  |
| Recommended      | Legacy                 | Modern               |

### Grant IP Field

```jsonc
{
  "grants": [
    {
      "src": ["group:team"],
      "dst": ["tag:server"],
      "ip": ["80/tcp", "443/tcp", "*/icmp"], // port/protocol pairs
    },
  ],
}
```

### App Capabilities

Grants can attach identity and capability information to connections:

```jsonc
{
  "grants": [
    {
      "src": ["autogroup:member"],
      "dst": ["tag:internal-app"],
      "app": {
        "tailscale.com/cap/drive": [
          {
            "shares": ["docs", "projects"],
          },
        ],
        "tailscale.com/cap/ssh": [
          {
            "users": ["ubuntu"],
          },
        ],
      },
    },
  ],
}
```

## Groups

Named collections of users for role-based access:

```jsonc
{
  "groups": {
    "group:engineering": ["alice@example.com", "bob@example.com"],
    "group:ops": [
      "charlie@example.com",
      "group:engineering", // Groups can nest
    ],
    "group:contractors": ["dave@contractor.com"],
  },
}
```

Groups are available on Premium plans. Use tags and autogroups on free/basic plans.

## Tags

Tags identify device roles independent of user identity. Tagged devices lose user association and are controlled entirely by ACL policy.

### Tag Owners

Define who can assign tags:

```jsonc
{
  "tagOwners": {
    "tag:server": ["group:ops"],
    "tag:web": ["group:engineering"],
    "tag:monitoring": ["group:ops", "tag:server"],
    "tag:k8s": ["tag:k8s-operator"],
  },
}
```

### Applying Tags

```bash
# Via CLI during registration
tailscale up --advertise-tags=tag:server,tag:web

# Via set command
tailscale set --advertise-tags=tag:server

# Via auth key (automatic)
# Create auth key with tags in admin console
```

### Tag Best Practices

- Use tags for servers, infrastructure, and automated systems
- Tag devices by role: `tag:web`, `tag:db`, `tag:monitoring`
- Tags remove user identity from devices - traffic is attributed to the tag, not the user who registered the device
- Devices with tags have key expiry disabled by default

## Hosts

Named aliases for IP addresses and CIDR ranges:

```jsonc
{
  "hosts": {
    "prod-db": "100.64.0.10",
    "staging-net": "10.10.0.0/16",
    "dns-server": "100.64.0.53",
  },
}
```

Use host names in ACL sources and destinations:

```jsonc
{ "action": "accept", "src": ["group:dba"], "dst": ["prod-db:5432"] }
```

## IP Sets

Group multiple IP addresses and CIDRs:

```jsonc
{
  "ipSets": {
    "ipset:internal-dns": ["100.64.0.53", "100.64.0.54"],
    "ipset:prod-servers": ["100.64.0.10/30", "100.64.0.20/30"],
  },
}
```

## SSH ACLs

Control Tailscale SSH access via the `ssh` section or grants.

### SSH Section Format

```jsonc
{
  "ssh": [
    {
      "action": "accept", // Immediate access
      "src": ["group:engineering"],
      "dst": ["tag:server"],
      "users": ["root", "deploy"], // Allowed SSH usernames
    },
    {
      "action": "check", // Require re-authentication
      "src": ["group:contractors"],
      "dst": ["tag:staging"],
      "users": ["deploy"],
      "checkPeriod": "12h", // Re-auth interval (default: 12h)
    },
  ],
}
```

### SSH Action Types

| Action   | Behavior                                     |
| -------- | -------------------------------------------- |
| `accept` | Immediate SSH access without additional auth |
| `check`  | Require identity provider re-authentication  |

### SSH Environment Variables

Allow forwarding of specific environment variables:

```jsonc
{
  "ssh": [
    {
      "action": "accept",
      "src": ["group:dev"],
      "dst": ["tag:server"],
      "users": ["deploy"],
      "acceptEnv": ["TERM", "LANG", "LC_*"],
    },
  ],
}
```

### SSH Recording

Enable SSH session recording for audit and compliance. Configure in the admin console or via the `recorder` field in SSH rules. Sessions can be recorded to Tailscale's infrastructure or a self-hosted `tsrecorder`.

### SSH via Grants

```jsonc
{
  "grants": [
    {
      "src": ["group:engineering"],
      "dst": ["tag:server"],
      "app": {
        "tailscale.com/cap/ssh": [
          {
            "users": ["root", "deploy"],
            "checkPeriod": "12h",
          },
        ],
      },
    },
  ],
}
```

## AutoApprovers

Automatically approve subnet routes and exit nodes without manual admin action:

```jsonc
{
  "autoApprovers": {
    "routes": {
      "10.0.0.0/8": ["tag:subnet-router"],
      "192.168.0.0/16": ["tag:office-router"],
      "0.0.0.0/0": ["tag:exit-node"], // Exit node route
    },
    "exitNode": ["tag:exit-node"],
  },
}
```

Without autoApprovers, an admin must manually approve each route in the admin console.

## Node Attributes

Apply extra attributes to devices matching specific conditions:

```jsonc
{
  "nodeAttrs": [
    {
      "target": ["tag:server"],
      "attr": ["funnel"], // Allow Funnel access
    },
    {
      "target": ["autogroup:member"],
      "attr": ["mullvad"], // Allow Mullvad exit nodes
    },
    {
      "target": ["*"],
      "app": {
        "tailscale.com/app-connectors": [
          {
            "connectors": ["tag:connector"],
            "domains": ["*.internal.example.com"],
          },
        ],
      },
    },
  ],
}
```

## Postures

Define device posture conditions for conditional access:

```jsonc
{
  "postures": {
    "posture:secure-device": [
      "node:os IN ['macos', 'windows']",
      "node:tsVersion >= '1.90'",
    ],
  },
}
```

Use postures in grants:

```jsonc
{
  "grants": [
    {
      "src": ["group:engineering"],
      "dst": ["tag:prod"],
      "ip": ["*"],
      "srcPosture": ["posture:secure-device"],
    },
  ],
}
```

## Policy Tests

Validate ACL rules with assertions:

```jsonc
{
  "tests": [
    {
      "src": "alice@example.com",
      "accept": ["tag:web:80", "tag:web:443"],
      "deny": ["tag:db:5432"],
    },
    {
      "src": "tag:app",
      "accept": ["tag:db:5432"],
      "deny": ["tag:web:22"],
    },
  ],
  "sshTests": [
    {
      "src": "alice@example.com",
      "dst": ["tag:server"],
      "accept": ["root"],
      "deny": ["admin"],
    },
  ],
}
```

Tests run on every policy save and block invalid configurations.

## Auth Keys

Pre-authentication keys for non-interactive device registration.

### Key Types

| Type             | Description                      | Use Case                           |
| ---------------- | -------------------------------- | ---------------------------------- |
| **One-off**      | Single use, auto-revoked         | Cloud server provisioning          |
| **Reusable**     | Multiple uses                    | Fleet deployment (guard carefully) |
| **Ephemeral**    | Device auto-removed when offline | Containers, Lambda, CI             |
| **Pre-approved** | Skip device approval             | Automated provisioning             |
| **Tagged**       | Apply tags automatically         | Infrastructure deployment          |
| **Pre-signed**   | For Tailnet Lock environments    | Locked-down networks               |

### Key Properties

- **Expiry:** 1-90 days (default: 90 days)
- **Scope:** Only Owners, Admins, IT admins, or Network admins can create/revoke
- **Device expiry:** Tagged devices have disabled key expiry by default
- **Node key expiry:** Devices stay authorized for 180 days after registration regardless of auth key expiry

### Usage

```bash
# Register with auth key
tailscale up --auth-key=tskey-auth-xxxxx

# Docker/container
docker run -e TS_AUTHKEY=tskey-auth-xxxxx tailscale/tailscale

# Pre-signed for Tailnet Lock
tailscale lock sign tskey-auth-xxxxx
# Use the output as the auth key
```

### OAuth Clients

For automation and API access, use OAuth clients instead of auth keys:

- Non-expiring credentials
- Scope-based permissions
- Support for client credentials flow
- Used by Terraform provider, K8s Operator, and CI/CD

Create OAuth clients in the admin console under Settings > OAuth clients.

## Tailscale API

### Authentication

Two methods:

1. **API access tokens** - Created in admin console, expire after 90 days
2. **OAuth clients** (recommended) - Non-expiring, scope-based

### Base URL

```
https://api.tailscale.com/api/v2
```

### Key Endpoints

**Devices:**

```bash
# List devices
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/tailnet/-/devices

# Get device details
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/device/{deviceId}

# Authorize device
curl -X POST -u "$TS_API_KEY:" \
  -d '{"authorized": true}' \
  https://api.tailscale.com/api/v2/device/{deviceId}/authorized

# Delete device
curl -X DELETE -u "$TS_API_KEY:" \
  https://api.tailscale.com/api/v2/device/{deviceId}

# Set device tags
curl -X POST -u "$TS_API_KEY:" \
  -d '{"tags": ["tag:server"]}' \
  https://api.tailscale.com/api/v2/device/{deviceId}/tags

# Set device key expiry
curl -X POST -u "$TS_API_KEY:" \
  -d '{"keyExpiryDisabled": true}' \
  https://api.tailscale.com/api/v2/device/{deviceId}/key
```

**Auth Keys:**

```bash
# Create auth key
curl -X POST -u "$TS_API_KEY:" \
  -d '{"capabilities": {"devices": {"create": {"reusable": false, "ephemeral": true, "tags": ["tag:ci"]}}}, "expirySeconds": 86400}' \
  https://api.tailscale.com/api/v2/tailnet/-/keys

# List auth keys
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/tailnet/-/keys

# Get auth key details
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/tailnet/-/keys/{keyId}

# Delete auth key
curl -X DELETE -u "$TS_API_KEY:" \
  https://api.tailscale.com/api/v2/tailnet/-/keys/{keyId}
```

**DNS:**

```bash
# Get DNS nameservers
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/tailnet/-/dns/nameservers

# Set DNS nameservers
curl -X POST -u "$TS_API_KEY:" \
  -d '{"dns": ["1.1.1.1", "8.8.8.8"]}' \
  https://api.tailscale.com/api/v2/tailnet/-/dns/nameservers

# Get search paths
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/tailnet/-/dns/searchpaths

# Get MagicDNS status
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/tailnet/-/dns/preferences
```

**ACL Policy:**

```bash
# Get current policy
curl -s -u "$TS_API_KEY:" https://api.tailscale.com/api/v2/tailnet/-/acl

# Set policy
curl -X POST -u "$TS_API_KEY:" \
  -H "Content-Type: application/json" \
  -d @policy.json \
  https://api.tailscale.com/api/v2/tailnet/-/acl

# Preview policy changes
curl -X POST -u "$TS_API_KEY:" \
  -d @policy.json \
  https://api.tailscale.com/api/v2/tailnet/-/acl/preview
```

**OAuth Token:**

```bash
# Get OAuth token
curl -X POST \
  -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" \
  https://api.tailscale.com/api/v2/oauth/token
```

### API Scopes (OAuth)

| Scope          | Description                                |
| -------------- | ------------------------------------------ |
| `devices:core` | Read/write devices, authorize, manage tags |
| `auth_keys`    | Create and manage auth keys                |
| `routes`       | Manage subnet routes                       |
| `dns`          | Manage DNS settings                        |
| `acl`          | Read/write ACL policy                      |
| `services`     | Manage Tailscale Services                  |
| `logs:read`    | Read network flow logs                     |

## Tailnet Lock

Cryptographic verification ensuring only signed nodes join the tailnet.

### Concepts

- **Node Key:** Public/private key pair for each device
- **Tailnet Lock Key (TLK):** Signing key generated per node, stored in Tailnet Key Authority (TKA)
- **Signing Node:** Device authorized to sign new nodes into the network
- **Disablement Secrets:** 10 passwords generated during init; one required to disable Tailnet Lock

### Setup

1. Enable in admin console: Device Management > Enable Tailnet Lock
2. Add signing nodes (minimum 2)
3. Run on a signing node:

```bash
tailscale lock init
```

4. Store the 10 disablement secrets securely

### Operations

```bash
# Check Tailnet Lock status
tailscale lock status

# Sign a new node
tailscale lock sign nodekey:<key>

# Pre-sign an auth key for automated deployment
tailscale lock sign tskey-auth-xxxxx

# Add a new signing node
tailscale lock add tlpub:<key>

# Remove a signing node
tailscale lock remove tlpub:<key>

# Revoke compromised signing keys (requires co-signing)
tailscale lock revoke-keys

# Disable Tailnet Lock
tailscale lock disable <disablement-secret>

# Emergency local disable (single node)
tailscale lock local-disable

# View TKA change log
tailscale lock log
```

### Constraints

- Maximum 20 signing nodes per tailnet
- Mutually exclusive with device approval feature
- Android cannot be signing nodes
- Annual key rotation recommended
- Lost disablement secrets without contacting Tailscale support means permanent lock

## Device Management

### Device Approval

Require admin approval before new devices join:

- Enable in admin console under Device Management
- Mutually exclusive with Tailnet Lock
- Use `pre-approved` auth keys to bypass approval for automated systems

### Key Expiry

Node keys expire after 180 days by default. Manage expiry:

```bash
# Disable key expiry for a device (API)
curl -X POST -u "$TS_API_KEY:" \
  -d '{"keyExpiryDisabled": true}' \
  https://api.tailscale.com/api/v2/device/{deviceId}/key
```

Tagged devices have key expiry disabled by default.

### Device Posture

Check device security state before granting access:

- OS version requirements
- Tailscale version requirements
- Custom posture attributes

### Node Key Sealing (v1.90+)

Hardware-backed protection for node keys using TPM (Trusted Platform Module):

- **Linux:** Uses TPM 2.0 when available
- **Windows:** Uses Windows TPM integration
- **macOS:** Uses Secure Enclave

Prevents node key extraction even if device storage is compromised. GA as of v1.90.

## HTTPS Certificates

Tailscale automatically provisions Let's Encrypt certificates for `*.ts.net` domains.

### Automatic (via Serve/Funnel)

```bash
tailscale serve 3000
# Automatically provisions cert for device.tailnet.ts.net
```

### Manual

```bash
tailscale cert myserver.tailnet-name.ts.net
# Outputs myserver.tailnet-name.ts.net.crt and .key files

tailscale cert --cert-file=/etc/nginx/ssl/ts.crt \
  --key-file=/etc/nginx/ssl/ts.key \
  myserver.tailnet-name.ts.net
```

### Rate Limits

Let's Encrypt enforces rate limits. If exceeded, wait up to 34 hours. Use `--min-validity` to avoid unnecessary renewals:

```bash
tailscale cert --min-validity=720h myserver.tailnet-name.ts.net
```

## Complete Policy File Example

```jsonc
{
  // User groups
  "groups": {
    "group:engineering": ["alice@example.com", "bob@example.com"],
    "group:ops": ["charlie@example.com"],
    "group:contractors": ["dave@contractor.com"],
  },

  // Tag ownership
  "tagOwners": {
    "tag:server": ["group:ops"],
    "tag:web": ["group:engineering"],
    "tag:db": ["group:ops"],
    "tag:monitoring": ["group:ops"],
    "tag:exit-node": ["group:ops"],
    "tag:k8s": ["tag:k8s-operator"],
    "tag:k8s-operator": ["group:ops"],
  },

  // Host aliases
  "hosts": {
    "prod-db": "100.64.0.10",
  },

  // Access rules
  "acls": [
    // Ops: full access everywhere
    { "action": "accept", "src": ["group:ops"], "dst": ["*:*"] },

    // Engineering: access web and app servers
    {
      "action": "accept",
      "src": ["group:engineering"],
      "dst": ["tag:web:*", "tag:server:22,80,443"],
    },

    // Web servers can reach databases
    { "action": "accept", "src": ["tag:web"], "dst": ["tag:db:5432,3306"] },

    // Monitoring can ping everything
    {
      "action": "accept",
      "src": ["tag:monitoring"],
      "proto": "icmp",
      "dst": ["*:*"],
    },
    {
      "action": "accept",
      "src": ["tag:monitoring"],
      "dst": ["*:9090,9100,3000"],
    },

    // Allow exit node usage for remote workers
    {
      "action": "accept",
      "src": ["group:contractors"],
      "dst": ["autogroup:internet:*"],
    },

    // K8s operator management
    { "action": "accept", "src": ["tag:k8s-operator"], "dst": ["tag:k8s:*"] },
  ],

  // SSH access
  "ssh": [
    {
      "action": "accept",
      "src": ["group:ops"],
      "dst": ["tag:server"],
      "users": ["root", "deploy"],
    },
    {
      "action": "check",
      "src": ["group:engineering"],
      "dst": ["tag:server"],
      "users": ["deploy"],
      "checkPeriod": "12h",
    },
    {
      "action": "accept",
      "src": ["group:ops"],
      "dst": ["tag:monitoring"],
      "users": ["root"],
    },
  ],

  // Auto-approve routes
  "autoApprovers": {
    "routes": {
      "10.0.0.0/8": ["tag:server"],
      "192.168.0.0/16": ["tag:server"],
    },
    "exitNode": ["tag:exit-node"],
  },

  // Node attributes
  "nodeAttrs": [
    { "target": ["autogroup:member"], "attr": ["funnel"] },
    { "target": ["autogroup:member"], "attr": ["mullvad"] },
  ],

  // Policy tests
  "tests": [
    {
      "src": "alice@example.com",
      "accept": ["tag:web:80", "tag:web:443", "tag:server:22"],
      "deny": ["tag:db:5432"],
    },
    {
      "src": "tag:web",
      "accept": ["tag:db:5432"],
      "deny": ["tag:server:22"],
    },
    {
      "src": "dave@contractor.com",
      "accept": ["autogroup:internet:443"],
      "deny": ["tag:server:22", "tag:db:5432"],
    },
  ],
}
```

## Terraform Provider

Manage Tailscale infrastructure as code with the official Terraform provider.

### Authentication

```hcl
provider "tailscale" {
  # Option 1: OAuth client (recommended)
  oauth_client_id     = var.tailscale_oauth_client_id
  oauth_client_secret = var.tailscale_oauth_client_secret

  # Option 2: API key
  api_key = var.tailscale_api_key

  # Target tailnet
  tailnet = "example.com"
}
```

Environment variables: `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET`, `TAILSCALE_API_KEY`, `TAILSCALE_TAILNET`.

### Key Resources

```hcl
# Manage ACL policy
resource "tailscale_acl" "main" {
  acl = jsonencode({
    acls = [
      {
        action = "accept"
        src    = ["group:engineering"]
        dst    = ["tag:server:*"]
      }
    ]
  })
}

# Create auth key
resource "tailscale_tailnet_key" "deploy" {
  reusable      = true
  ephemeral     = true
  preauthorized = true
  tags          = ["tag:server"]
  expiry        = 3600  # seconds
}

# Manage DNS nameservers
resource "tailscale_dns_nameservers" "main" {
  nameservers = ["1.1.1.1", "8.8.8.8"]
}

# Manage DNS search paths
resource "tailscale_dns_search_paths" "main" {
  search_paths = ["example.com", "internal.example.com"]
}

# Manage device properties
resource "tailscale_device_authorization" "server" {
  device_id  = "device-id"
  authorized = true
}

resource "tailscale_device_key" "server" {
  device_id           = "device-id"
  key_expiry_disabled = true
}

resource "tailscale_device_tags" "server" {
  device_id = "device-id"
  tags      = ["tag:server", "tag:web"]
}

# Manage device subnet routes
resource "tailscale_device_subnet_routes" "router" {
  device_id = "device-id"
  routes    = ["10.0.0.0/8", "192.168.0.0/16"]
}
```

## SCIM Provisioning

Synchronize users from identity providers using SCIM (System for Cross-domain Identity Management):

```
Endpoint: https://api.tailscale.com/api/v2/tailnet/{tailnet}/scim/v2
```

Supported identity providers:

- Okta
- Azure AD / Entra ID
- OneLogin
- Generic SCIM 2.0 providers

SCIM handles automatic user provisioning, deprovisioning, and group synchronization.

## Workload Identity Federation (v1.92+)

Authenticate Tailscale without long-lived secrets using provider-native identity tokens:

### Supported Providers

- AWS (IAM roles, ECS task roles)
- GCP (Service account identity)
- Azure (Managed identity)
- Kubernetes (ServiceAccount tokens)
- GitHub Actions (OIDC tokens)

### Docker Usage

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    environment:
      - TS_ID_TOKEN=${IDENTITY_TOKEN}
      - TS_AUDIENCE=tailscale
```

### Benefits

- No secret rotation required
- Short-lived, auto-refreshed tokens
- Tied to workload identity, not static credentials
- Audit trail tied to provider identity

## Security Best Practices

### Policy Design

- Start with deny-all (empty ACLs section) and add rules incrementally
- Use tags for infrastructure, groups for people
- Prefer grants over legacy ACLs for new policies
- Write policy tests for every critical access rule
- Review policies regularly; use the Visual Policy Editor for audits

### Authentication

- Use OAuth clients over API keys for automation
- Set short expiry on auth keys (24h for one-time provisioning)
- Use ephemeral keys for containers and ephemeral workloads
- Enable Tailnet Lock for high-security environments
- Rotate API keys before expiry (90-day limit)

### Network Security

- Enable shields-up mode on devices that should not accept incoming connections
- Use check-mode SSH for contractor and temporary access
- Enable SSH session recording for compliance
- Monitor network flow logs for anomalous traffic
- Apply device posture checks for production access

### Key Management

- Store Tailnet Lock disablement secrets in a password manager or hardware vault
- Rotate signing nodes annually
- Use pre-signed auth keys with Tailnet Lock
- Enable node key sealing (TPM) on sensitive devices
- Revoke compromised signing keys immediately with `tailscale lock revoke-keys`
