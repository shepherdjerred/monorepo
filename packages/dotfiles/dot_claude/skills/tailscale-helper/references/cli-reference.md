# Tailscale CLI Reference

Complete reference for the `tailscale` command-line interface. All commands accept `--socket=<path>` to specify a custom tailscaled socket.

## tailscale up

Connect the device to Tailscale and authenticate if needed. Prefer `tailscale set` for changing individual settings without re-specifying all flags.

```bash
tailscale up [flags]
```

**Flags:**
- `--auth-key=<key>` - Auth key for non-interactive login
- `--accept-routes` - Accept subnet routes from other nodes
- `--accept-dns` - Accept DNS configuration from admin console (default: true)
- `--advertise-exit-node` - Offer this node as an exit node
- `--advertise-routes=<cidr,cidr>` - Expose subnet routes (comma-separated CIDRs)
- `--advertise-tags=<tag:x,tag:y>` - Request ACL tags
- `--exit-node=<ip|hostname>` - Route all traffic through specified exit node
- `--exit-node-allow-lan-access` - Allow local network access when using exit node
- `--hostname=<name>` - Override device hostname in tailnet
- `--login-server=<url>` - Coordination server URL (for Headscale)
- `--operator=<user>` - Allow specified OS user to operate tailscale without sudo
- `--reset` - Reset unspecified settings to defaults
- `--shields-up` - Block all incoming connections
- `--ssh` - Enable Tailscale SSH server
- `--timeout=<duration>` - Maximum wait time for login (default: 0, wait forever)

**Examples:**
```bash
# Basic connection
tailscale up

# Headscale / custom coordination server
tailscale up --login-server=https://headscale.example.com

# Subnet router
tailscale up --advertise-routes=192.168.1.0/24,10.0.0.0/8

# Exit node with local LAN access
tailscale up --exit-node=100.64.0.5 --exit-node-allow-lan-access

# Container/server with auth key
tailscale up --auth-key=tskey-auth-xxxxx --hostname=prod-server
```

## tailscale down

Disconnect from Tailscale. The device remains registered but stops participating in the tailnet.

```bash
tailscale down [flags]
```

**Flags:**
- `--accept-risk=<risk>` - Accept risk of disconnection (for scripting)
- `--reason=<description>` - Record reason for disconnection

## tailscale set

Change individual preferences without re-specifying all settings. Preferred over `tailscale up` for modifying configuration.

```bash
tailscale set [flags]
```

**Flags (same as `up` plus):**
- `--auto-update` - Enable automatic updates
- `--advertise-connector` - Advertise as app connector
- `--webclient` - Enable web client interface

**Examples:**
```bash
# Enable SSH server
tailscale set --ssh

# Change hostname
tailscale set --hostname=new-name

# Enable exit node
tailscale set --advertise-exit-node

# Accept routes from subnet routers
tailscale set --accept-routes

# Disable incoming connections
tailscale set --shields-up
```

## tailscale login

Authenticate and add device to the tailnet without modifying connection state. Useful for initial setup scripts.

```bash
tailscale login [flags]
```

Accepts the same flags as `tailscale up`. Outputs a URL for browser authentication unless `--auth-key` is provided.

## tailscale logout

Disconnect from Tailscale and expire the current authentication session. The device must re-authenticate to rejoin.

```bash
tailscale logout
```

## tailscale status

Display the connection status table showing all tailnet peers.

```bash
tailscale status [flags]
```

**Flags:**
- `--json` - Output full status as JSON
- `--web` - Start a web server displaying status
- `--active` - Show only active connections
- `--peers` - Show peer details (default: true)
- `--self` - Show self details (default: true)

**Output columns:** IP address, hostname, OS, connection type (direct/relay), idle time, transfer stats.

**Example JSON parsing:**
```bash
# List all peer hostnames
tailscale status --json | jq -r '.Peer[] | .HostName'

# Show direct vs relay connections
tailscale status --json | jq '.Peer[] | {name: .HostName, relay: .Relay}'

# Find active peers
tailscale status --json | jq '.Peer[] | select(.Active == true) | .HostName'
```

## tailscale ip

Display the Tailscale IP address(es) for this device or a peer.

```bash
tailscale ip [flags] [peer]
```

**Flags:**
- `--4` - Show only IPv4 address
- `--6` - Show only IPv6 address
- `--1` - Show single address, preferring IPv4

**Examples:**
```bash
tailscale ip              # Show own IPs
tailscale ip --4          # IPv4 only
tailscale ip myserver     # Show peer's IP
```

## tailscale ping

Ping a tailnet device to test connectivity and measure latency. Uses TSMP (Tailscale Message Protocol) by default.

```bash
tailscale ping [flags] <hostname|ip>
```

**Flags:**
- `--c=<count>` - Number of pings (default: 10)
- `--timeout=<duration>` - Timeout per ping (default: 5s)
- `--icmp` - Use ICMP instead of TSMP
- `--tsmp` - Use TSMP (default)
- `--until-direct` - Ping until a direct connection is established
- `--verbose` - Verbose output

**Examples:**
```bash
tailscale ping myserver
tailscale ping --c=3 --icmp 100.64.0.5
tailscale ping --until-direct myserver   # Wait for direct path
```

## tailscale ssh

Establish an SSH session to a tailnet device using Tailscale identity instead of SSH keys.

```bash
tailscale ssh [ssh-flags] [user@]<host> [command]
```

Requires Tailscale SSH enabled on the destination (`tailscale set --ssh`) and proper SSH ACLs in the policy file. Supports standard SSH flags like `-L` for port forwarding.

## tailscale netcheck

Run network diagnostics to assess connectivity conditions.

```bash
tailscale netcheck [flags]
```

**Flags:**
- `--every=<duration>` - Repeat at interval
- `--format=<json|text>` - Output format
- `--verbose` - Include extra details

**Reports:** UDP connectivity, IPv4/IPv6 support, nearest DERP region, port mapping (UPnP/PCP/NAT-PMP), and latency to each DERP server.

## tailscale serve

Share a local service within the tailnet. Automatically provisions HTTPS certificates.

```bash
tailscale serve [flags] <target>
```

**Flags:**
- `--https=<port>` - HTTPS port (default: 443)
- `--http=<port>` - HTTP port
- `--tcp=<port>` - Raw TCP port
- `--tls-terminated-tcp=<port>` - TLS-terminated TCP
- `--set-path=<path>` - URL path prefix
- `--proxy-protocol=<1|2>` - PROXY protocol version
- `-bg` - Run in background (persists across reboots)

**Target types:**
- `localhost:3000` - Reverse proxy to local HTTP service
- `/path/to/dir` - Serve files from directory
- `text:"Hello"` - Serve static text response

**Subcommands:**
- `status [--json]` - Show active serve configuration
- `reset` - Clear all serve configuration
- `get-config <file>` - Export config to file
- `set-config <file>` - Import config from file

**Examples:**
```bash
# Proxy local dev server
tailscale serve --https=443 localhost:3000

# Serve files
tailscale serve /var/www/html

# Background mode (survives reboots)
tailscale serve -bg localhost:8080

# Multiple ports
tailscale serve --https=443 localhost:3000
tailscale serve --https=8443 localhost:8080

# TCP forwarding
tailscale serve --tcp=5432 localhost:5432

# TLS termination with PROXY protocol
tailscale serve --tls-terminated-tcp=443 --proxy-protocol=2 localhost:8080

# Turn off
tailscale serve --https=443 localhost:3000 off
```

## tailscale funnel

Expose a local service to the public internet via Tailscale relay. Creates a publicly accessible `https://<device>.<tailnet>.ts.net` URL.

```bash
tailscale funnel [flags] <target>
```

Accepts the same flags as `tailscale serve`. Limited to ports 443, 8443, and 10000. Requires MagicDNS enabled.

**Subcommands:** `status`, `reset` (same as serve)

**Examples:**
```bash
# Expose local web server to internet
tailscale funnel 3000

# Background mode
tailscale funnel -bg 8080

# Specific port
tailscale funnel --https=8443 localhost:3000

# Check status
tailscale funnel status
```

## tailscale file (Taildrop)

Transfer files between tailnet devices.

### tailscale file cp
```bash
tailscale file cp [flags] <file...> <target>:
```

**Flags:**
- `--name=<name>` - Override filename
- `--targets` - List available targets
- `--verbose` - Verbose output

### tailscale file get
```bash
tailscale file get [flags] <download-dir>
```

**Flags:**
- `--conflict=<skip|overwrite|rename>` - File conflict behavior
- `--loop` - Keep receiving files
- `--wait` - Wait for files if none available
- `--verbose` - Verbose output

**Examples:**
```bash
# Send file to peer
tailscale file cp report.pdf myserver:

# Send multiple files
tailscale file cp *.log myserver:

# Receive files
tailscale file get ~/Downloads

# Continuous receive
tailscale file get --loop --wait ~/incoming
```

## tailscale drive

Share directories via Tailscale Drive (Taildrive).

```bash
tailscale drive share <name> <path>     # Share a directory
tailscale drive rename <old> <new>      # Rename share
tailscale drive unshare <name>          # Remove share
tailscale drive list                    # List shares
```

## tailscale cert

Generate TLS certificates from Let's Encrypt for the device's tailnet domain.

```bash
tailscale cert [flags] <domain>
```

**Flags:**
- `--cert-file=<path>` - Certificate output path (default: `<domain>.crt`)
- `--key-file=<path>` - Key output path (default: `<domain>.key`)
- `--min-validity=<duration>` - Minimum remaining validity before renewal
- `--serve-demo` - Start demo HTTPS server

**Examples:**
```bash
# Generate cert for this device
tailscale cert myserver.tailnet-name.ts.net

# Custom paths
tailscale cert --cert-file=/etc/ssl/ts.crt --key-file=/etc/ssl/ts.key myserver.tailnet-name.ts.net
```

## tailscale lock

Manage Tailnet Lock for cryptographic node verification.

```bash
tailscale lock init                        # Initialize Tailnet Lock
tailscale lock status                      # View status and signing keys
tailscale lock sign nodekey:<key>          # Sign a node's key
tailscale lock sign <auth-key>             # Pre-sign an auth key
tailscale lock add tlpub:<key>             # Add trusted signing key
tailscale lock remove tlpub:<key>          # Remove signing key
tailscale lock revoke-keys                 # Revoke compromised keys
tailscale lock disable <secret>            # Disable Tailnet Lock
tailscale lock local-disable               # Emergency local disable
tailscale lock log                         # View TKA change log
```

## tailscale exit-node

Manage exit node selection.

```bash
tailscale exit-node list                    # List available exit nodes
tailscale exit-node list --filter=<country> # Filter by country
tailscale exit-node suggest                 # Suggest optimal exit node
```

## tailscale switch

Switch between Tailscale accounts on multi-account devices.

```bash
tailscale switch <account-id>    # Switch to account
tailscale switch --list          # List available accounts
```

## tailscale whois

Identify the device and user associated with a Tailscale IP address.

```bash
tailscale whois [--json] <ip[:port]>
```

## tailscale nc

Proxy TCP connections through Tailscale. Connects stdin/stdout to a port on a tailnet host.

```bash
tailscale nc <host> <port>
```

## tailscale dns

Manage DNS settings and resolution.

```bash
tailscale dns status [--all]     # Show DNS resolver info
tailscale dns query <name>       # Query DNS through Tailscale
```

## tailscale metrics

Access client metrics for monitoring.

```bash
tailscale metrics print              # Print metrics to stdout
tailscale metrics write <file>       # Write metrics to file
```

## tailscale bugreport

Generate diagnostic information for troubleshooting.

```bash
tailscale bugreport [flags]
```

**Flags:**
- `--diagnose` - Include extended diagnostics
- `--record` - Record network activity

## tailscale update

Update the Tailscale client.

```bash
tailscale update [flags]
```

**Flags:**
- `--dry-run` - Check for updates without installing
- `--track=<stable|unstable>` - Release track
- `--version=<version>` - Install specific version
- `--yes` - Skip confirmation

## tailscale configure

Configure platform-specific settings.

```bash
tailscale configure kubeconfig    # Generate kubeconfig for K8s API proxy
tailscale configure mac-vpn       # macOS VPN configuration
tailscale configure synology      # Synology NAS configuration
tailscale configure sysext        # System extension management
tailscale configure systray       # System tray configuration
```

## tailscale syspolicy

List or reload system policies (MDM/GPO).

```bash
tailscale syspolicy list [--json]    # List active policies
tailscale syspolicy reload           # Reload policies
```

## tailscale web

Start a local web interface for managing the Tailscale daemon.

```bash
tailscale web [flags]
```

**Flags:**
- `--listen=<addr>` - Listen address (default: localhost:8088)
- `--cgi` - Run in CGI mode
- `--readonly` - Disable write operations

## tailscale completion

Set up shell tab completion.

```bash
tailscale completion bash        # Bash completion
tailscale completion zsh         # Zsh completion
tailscale completion fish        # Fish completion
tailscale completion powershell  # PowerShell completion
```

**Flags:**
- `--flags` - Include flag completions (default: true)
- `--descs` - Include descriptions (default: true)

## tailscale version

Display version information.

```bash
tailscale version [flags]
```

**Flags:**
- `--daemon` - Show daemon version
- `--json` - JSON output
- `--upstream` - Check latest upstream version

## tailscale licenses

Display open source license information for bundled dependencies.

```bash
tailscale licenses
```

## tailscale appc-routes

Print app connector route status. App connectors route traffic to SaaS applications through the tailnet.

```bash
tailscale appc-routes [flags]
```

**Flags:**
- `--all` - Show all routes including inactive
- `--map` - Show route mapping table
- `--n` - Numeric output (skip DNS resolution)

## tailscale debug

Advanced debugging commands for troubleshooting. Not all subcommands are stable.

```bash
tailscale debug derp-map             # Show DERP relay map
tailscale debug netmap               # Show network map
tailscale debug peer-status          # Detailed peer connection info
tailscale debug portmap              # Test port mapping protocols
tailscale debug prefs                # Show current preferences
tailscale debug local-creds-store    # Debug credential storage
tailscale debug capture              # Capture packet trace
```

## Common Workflows

### Initial Server Setup

```bash
# Install on Linux
curl -fsSL https://tailscale.com/install.sh | sh

# Start and authenticate
sudo tailscale up

# Enable SSH access
sudo tailscale set --ssh

# Advertise as subnet router
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale set --advertise-routes=192.168.1.0/24

# Check connection
tailscale status
```

### Automated Container Registration

```bash
# Generate ephemeral auth key via API
AUTH_KEY=$(curl -s -X POST -u "$TS_API_KEY:" \
  -d '{"capabilities":{"devices":{"create":{"ephemeral":true,"tags":["tag:container"]}}}}' \
  https://api.tailscale.com/api/v2/tailnet/-/keys | jq -r '.key')

# Use in container
docker run -d \
  -e TS_AUTHKEY=$AUTH_KEY \
  -e TS_HOSTNAME=my-service \
  tailscale/tailscale:latest
```

### Headscale (Self-Hosted Coordination Server)

```bash
# Connect to Headscale instance
tailscale up --login-server=https://headscale.example.com

# Register with pre-auth key
tailscale up --login-server=https://headscale.example.com --auth-key=<key>
```

### Network Troubleshooting Workflow

```bash
# 1. Check overall status
tailscale status

# 2. Run network diagnostics
tailscale netcheck

# 3. Test specific peer connectivity
tailscale ping --until-direct myserver

# 4. Check DNS resolution
tailscale dns status
tailscale dns query myserver

# 5. Generate full bug report
tailscale bugreport --diagnose
```

### Serve + Funnel Development Workflow

```bash
# Start local dev server
npm run dev  # Runs on localhost:3000

# Share within tailnet (private)
tailscale serve localhost:3000

# Share to internet (public)
tailscale funnel 3000

# Check what's being served
tailscale serve status

# Stop serving
tailscale serve reset
tailscale funnel reset
```

### Multi-Account Management

```bash
# List available accounts
tailscale switch --list

# Switch to work account
tailscale switch work-tailnet-id

# Switch to personal account
tailscale switch personal-tailnet-id
```

## tailscaled (Daemon)

The Tailscale daemon process. Runs as a system service on most platforms.

**Linux:**
```bash
# Start/restart
sudo systemctl restart tailscaled

# Check status
sudo systemctl status tailscaled

# Enable on boot
sudo systemctl enable tailscaled

# View logs
journalctl -u tailscaled -f

# View recent logs with timestamps
journalctl -u tailscaled --since "1 hour ago"

# Custom flags
sudo tailscaled --port=41641 --state=/var/lib/tailscale/tailscaled.state
```

**macOS:**
Runs automatically via the Tailscale app or system extension. Logs accessible via `log show --predicate 'process=="tailscaled"'`.

```bash
# View macOS logs
log show --predicate 'process=="tailscaled"' --last 1h

# Stream macOS logs
log stream --predicate 'process=="tailscaled"'
```

**Windows:**
Runs as a Windows service. Manage via Services console or PowerShell:
```powershell
# Restart service
Restart-Service Tailscale

# Check service status
Get-Service Tailscale

# View logs
Get-WinEvent -LogName Application | Where-Object {$_.ProviderName -eq "Tailscale"}
```

**Key daemon flags:**
- `--port=<port>` - WireGuard listen port (default: 0/random, 41641 if available)
- `--state=<path>` - State file location
- `--statedir=<path>` - State directory for multi-file state
- `--tun=<name>` - TUN device name (default: tailscale0)
- `--verbose=<level>` - Verbosity level (0-2)
- `--socks5-server=<addr>` - Run a SOCKS5 proxy
- `--outbound-http-proxy-listen=<addr>` - Run an HTTP proxy

## Environment Variables

These environment variables affect `tailscale` and `tailscaled` behavior:

| Variable | Purpose |
|----------|---------|
| `TS_DEBUG_FIREWALL_MODE` | Override firewall mode detection |
| `TS_DEBUG_MTU` | Override WireGuard MTU |
| `TS_LOGS_DIR` | Override log directory |
| `HTTPS_PROXY` | HTTP proxy for coordination server communication |
| `NO_PROXY` | Bypass proxy for specific hosts |
| `SSL_CERT_FILE` | Custom CA certificate for TLS verification |
