# Common Tailscale tasks

Recipes for moving things between machines. Sources: Taildrop
<https://tailscale.com/kb/1106/taildrop>, Serve
<https://tailscale.com/kb/1242/tailscale-serve>, Serve and Funnel use cases
<https://tailscale.com/kb/1247/funnel-serve-use-cases>, Tailscale SSH
<https://tailscale.com/kb/1193/tailscale-ssh>, Vite
<https://vite.dev/config/server-options>, Next.js
<https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins>.

## Name the target

Read `tailscale status`. Use the MagicDNS label in the first column (for example
`desktop`), not the OS hostname, which can differ (`Jerred-Desktop`). The full
name is `<label>.<tailnet>.ts.net`; take the suffix from live output. Machines
and their online state change, so do not copy a host list into other files.

## Reach a dev server from another machine

Pick one:

1. **Serve (HTTPS, tailnet only).** On the machine running the server:

   ```bash
   tailscale serve status            # note existing listeners first
   tailscale serve --bg 5173         # https://<label>.<tailnet>.ts.net/
   tailscale serve status            # confirm
   tailscale serve --https=443 off   # remove only this listener when done
   ```

   Serve proxies to `http://127.0.0.1:<port>`, so the dev server can stay bound
   to localhost. `--bg` keeps it configured after the command returns and across
   `down`/`up` or a reboot; without it the proxy stops when the command does.
   If another listener already uses 443, pass a different `--https=<port>`.

2. **Direct, over the tailnet address.** Bind the dev server to a non-loopback
   address and browse `http://<label>:<port>` from the other machine. This
   needs the framework's host settings below.

Framework host checks:

- **Vite** listens on localhost by default. Use `--host` or `server.host: true`
  for option 2. `server.allowedHosts` defaults to an empty list, so add the
  MagicDNS suffix with a leading dot (`.ts.net`). Prefer that to `true`, which
  disables the DNS-rebinding check. Behind Serve's HTTPS, set
  `server.ws.clientPort`; `server.hmr.host` and `server.hmr.clientPort` are
  deprecated.
- **Next.js** (`next dev`) listens on `0.0.0.0` by default, but blocks
  cross-origin dev requests to `/_next` unless `allowedDevOrigins` lists the
  hostname (for example `macbook.<tailnet>.ts.net`). Entries are hostnames only,
  with no scheme or port. `*` matches one label; `**` matches one or more and
  only at the start of a pattern.

## Send files between machines

Taildrop:

```bash
tailscale file cp report.pdf desktop:     # the trailing colon is required
tailscale file get ~/incoming             # receive on Linux; --wait or --loop to keep listening
```

- Taildrop is in public alpha; an admin must enable it for the tailnet.
- It works between devices owned by the same user. Tagged nodes cannot send or
  receive.
- macOS receivers save to `~/Downloads`; Windows receivers (v1.34+) save to
  `C:\Users\<user>\Downloads`. The GUI apps surface incoming files in their
  menus, and Windows can also send via right-click "Send with Tailscale".
- Interrupted transfers resume for about an hour, except when a Mac or iOS
  device receives.
- `tailscale file cp --targets` lists valid destinations.

For a folder you keep sharing, use Taildrive. `tailscale drive` is unsupported
with the macOS GUI app; configure it from the menu bar app's settings.

## rsync and scp

Tailscale SSH servers run on Linux and are not available in every macOS
build, and Windows support is unconfirmed, so check
`tailscale set --ssh --help` and the SSH documentation before relying on it. Any
device can be an SSH client. When Tailscale SSH is not available on the target,
use the OS's normal SSH server (macOS Remote Login, Windows OpenSSH Server) and
address it by MagicDNS name:

```bash
rsync -avP ./build/ user@desktop:/path/to/dest/
scp file user@desktop:
```

The Tailscale documentation covers SCP and SFTP through Tailscale SSH; rsync
over a regular SSH server is standard OpenSSH behavior. Tailscale SSH uses port
22 and its check mode can interrupt automation that opens many connections.

## Exposure checklist

1. `tailscale serve status` and `tailscale funnel status` before and after.
2. Serve for tailnet-only access. Funnel publishes to the public internet on
   ports 443, 8443, or 10000, so confirm it explicitly and never use it for a
   dev server.
3. Remove what you added with `off` on the same listener. Do not run
   `serve reset` on a machine with unrelated listeners.
4. Re-read the status and open the URL from the intended client.

## Cannot reach a host

Follow the official sequence at
<https://tailscale.com/docs/reference/troubleshooting/connectivity/connect-device-failure>,
adding local checks:

1. `tailscale version` on both ends; update if far apart.
2. `tailscale status`. A peer missing from the list points at policy or key
   expiry; the `Health` field in `status --json` lists local problems.
3. `tailscale ping --verbose <host>`. If it succeeds while a normal ping fails,
   an OS firewall is blocking. A path stuck on DERP means NAT traversal failed;
   check `tailscale netcheck`.
4. `tailscale nc <host> <port>` to test the actual port. If it fails but ping
   works, the service is not listening on a reachable address or a firewall
   blocks that port.
5. Check the service's bind address and, for web dev servers, allowed hosts (see
   above).
6. In the admin console, review ACLs, grants, and SSH rules with Preview rules,
   plus key expiry and tags.
7. Check for an exit node or subnet router changing the path. `tailscale dns
   status` and `tailscale dns query <name>` diagnose MagicDNS.

In boot scripts or launch agents that bind to the tailnet address, run
`tailscale wait` first so the interface and address exist.
