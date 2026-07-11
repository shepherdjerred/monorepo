---
id: torvalds-tailscale-authkey-duplication
status: active
origin: packages/docs/logs/2026-07-10_torvalds-kubelet-crashloop.md
---

# torvalds: duplicate TS_AUTHKEY in live Tailscale ExtensionServiceConfig

## Finding

The live Talos machine config's `ExtensionServiceConfig` (`name: tailscale`) has two
different `TS_AUTHKEY` values present simultaneously (each paired with a duplicated
`TS_ACCEPT_DNS=true`), discovered during the 2026-07-10 kubelet crash-loop incident
recovery. Almost certainly caused by the same `talosctl patch machineconfig`
append-not-replace behavior identified in that incident, applied to this document at
some earlier point in the node's history.

`packages/homelab/src/talos/patches/tailscale.yaml` (the file that would normally be
applied via `talosctl patch machineconfig --patch @src/talos/patches/tailscale.yaml`,
per `packages/homelab/src/talos/README.md`) is **gitignored** and does not exist
locally on this machine — only the committed `tailscale.example.yaml` template
exists. So there is no local/repo source of truth to diff the two keys against.

## Investigation performed (read-only, this session)

- Checked `talosctl -n torvalds logs ext-tailscale` around the most recent boot
  (2026-07-10T06:12:50Z, during the crash-loop recovery): the extension went
  `NoState -> Starting -> Running` and logged
  `control: RegisterReq: got response; nodeKeyExpired=false, machineAuthorized=true;
authURL=false`. This means the node reconnected using its own **persisted node
  identity/state**, not either `TS_AUTHKEY` — Tailscale only consumes `TS_AUTHKEY` for
  a brand-new/unauthenticated node or after local state is wiped. **Neither key is
  currently in active use for connectivity**, so this is not an active-outage risk.
- Checked 1Password (`op item list`) for a stored authkey to cross-reference: found
  only a `Tailscale` item (Personal vault, last updated 2022, just account
  username/password/SSO — not an API token or authkey) and `Tailscale k8s OAuth
client` (Homelab vault — a separate OAuth client used by the in-cluster Tailscale
  Kubernetes operator, unrelated to this host-level `ext-tailscale` extension). No
  record of either specific `TS_AUTHKEY` value exists in 1Password.
- No Tailscale API token was found to query the admin API (`api.tailscale.com`) for
  key validity/expiry/revocation status headlessly.

## Conclusion

Cannot determine which of the two keys is "correct" without either Tailscale admin
console UI access or an API token — and it doesn't matter for current connectivity
either way, since neither is being used for reconnection right now.

## Recommended fix (not applied — deferred)

Don't try to figure out which old key is valid. Instead: generate **one new**
Tailscale authkey via the admin console, replace both duplicate `TS_AUTHKEY`
entries (and the duplicated `TS_ACCEPT_DNS`) with a single clean set, and apply via
full-document `talosctl apply-config --mode=no-reboot` (not `talosctl patch
machineconfig` — see the append-vs-replace gotcha in
`packages/docs/logs/2026-07-10_torvalds-kubelet-crashloop.md`). This sidesteps the
need to identify which old key is live and eliminates the ambiguity outright. Low
priority — no current impact — but worth cleaning up before it causes confusion in a
future incident, and before `patches/tailscale.yaml` needs to be regenerated from
scratch for a re-provision (at which point whichever old key turns out to be
revoked/expired would silently fail the very first auth attempt, right when it's
needed).
