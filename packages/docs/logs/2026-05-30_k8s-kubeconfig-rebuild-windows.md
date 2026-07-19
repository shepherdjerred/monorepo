---
id: log-2026-05-30-k8s-kubeconfig-rebuild-windows
type: log
status: complete
board: false
---

# Rebuild Windows k8s/talos creds after cert rotation

## Context

Continuation of `2026-05-29_k8s-admin-cert-expired.md`. The admin kubeconfig on
`jerred-desktop` (Windows) had an expired client cert (`notAfter May 10 2026`), so all
`kubectl` calls to cluster `torvalds` failed with `the server has asked for the client to
provide credentials`. The cluster's leaf certs had since been rotated (new talosconfig
admin cert issued Apr 26 2026); the rotated material lived in 1Password but had never been
pulled down to this machine.

Goal: recreate a working kubeconfig locally **without rotating anything** (other machines
hold the current creds), and refresh the 1Password copy.

## Key facts established

- Cluster CA (`O=talos`) is valid 2025-05-04 -> **2035** — unchanged. Only leaf certs were
  rotated, so minting new leaf certs from the existing CA is safe and does NOT affect other
  machines. (The only thing that would break them is regenerating `secrets.yaml`/the CA.)
- `talosctl kubeconfig` issues a fresh independent leaf cert from the CA — a non-rotating op.

## What was done

1. Installed `talosctl` v1.13.3 (matches cluster) from `~/Downloads/talosctl-windows-amd64.exe`
   -> `C:\Users\Jerred\bin\talosctl.exe` (on PATH).
2. Pulled the `talosconfig` item from 1Password (Homelab vault, item
   `qtgyg6nwvbcfzu73w4ojmmr2ta`). It stores the config decomposed as `ca`/`crt`/`key`
   concealed fields. Reconstructed a talosconfig YAML at `C:\Users\Jerred\.talos\config`
   with endpoint/node `192.168.1.81`, context `torvalds`.
   - Verified: `talosctl version` authenticates; client cert (`O=os:admin`) valid -> 2027-04-26.
3. Minted a fresh kubeconfig (`talosctl kubeconfig ... --force`). New admin cert
   (`O=system:masters, CN=admin`) valid 2026-05-30 -> 2027-05-30.
4. Backed up `~/.kube/config` -> `~/.kube/config.bak-20260530`, then merged the new context
   into `~/.kube/config`. `kubectl get nodes` -> `torvalds Ready, v1.36.1`. OK
5. Updated the existing 1Password `kubeconfig` SECURE_NOTE (item `qbowip7zr7cggo5p5tam7g6rxe`)
   — refreshed `certificate-authority-data`, `client-certificate-data`, `client-key-data`
   (unlabeled section) and `notesPlain` (full kubeconfig YAML). Verified by readback: stored
   cert matches local exactly (same dates AND serial, notAfter May 30 2027).
6. Deleted all temp files containing key material.

## Gotchas (read before redoing this)

- **op CLI uses 1Password desktop-app integration** (`op whoami` = "not signed in"; auth
  delegated to the desktop app). Every secret read/write pops an approval dialog on
  `jerred-desktop` that must be clicked within ~90s — it silently times out / gets dismissed
  otherwise. `op item list` (metadata) works without it; `op item get` / `op read` /
  `op item edit` (contents) all require the click. No service-account token is configured.
- **`op item edit 'section.field=...'` CREATES a section if none with that label exists.**
  The kubeconfig item's original 3 fields live in an _unlabeled_ section, so prefixing with
  `kubeconfig.` created a stray "kubeconfig" section instead of updating them. Correct
  addressing for the original fields is the **bare label** (e.g. `client-certificate-data[concealed]=...`).
  Remove a field by setting it empty: `field[type]=`.
- Bun on Windows resolves `/tmp` to `C:\Users\Jerred\AppData\Local\Temp`, which differs from
  git-bash's `/tmp`. Pass absolute Windows paths to `bun`.

## Session Log — 2026-05-30

### Done

- Installed talosctl v1.13.3 to `~/bin`.
- Reconstructed `~/.talos/config` from the 1P talosconfig item (valid -> 2027-04-26).
- Minted a fresh kubeconfig from the existing CA (no rotation), merged into `~/.kube/config`
  (valid -> 2027-05-30); `kubectl get nodes` works.
- Backed up old kubeconfig to `~/.kube/config.bak-20260530`.
- Refreshed the 1P `kubeconfig` item (3 fields + notesPlain); verified it matches local
  (same serial). Cleaned up the accidental section created mid-edit.
- Cleaned up temp secret files.

### Remaining

- None required. Optional: local kubeconfig + 1P copy use endpoint `192.168.1.81` (LAN). For
  off-LAN use, switch `server:`/talos endpoint to `torvalds.tailnet-1a49.ts.net`.
- Optional: schedule a cert-expiry early-warning (~Apr 2027 talosconfig, ~May 2027 kubeconfig).

### Caveats

- All creds minted from the existing CA — other machines are unaffected. Do NOT regenerate
  `secrets.yaml`/the CA unless re-issuing creds everywhere.
- `op` on this machine requires interactive desktop approval per secret op; non-interactive
  / cron use will hang without a service-account token.
