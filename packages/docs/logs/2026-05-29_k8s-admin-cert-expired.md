---
id: log-2026-05-29-k8s-admin-cert-expired
type: log
status: complete
board: false
---

# k8s not working — expired admin client certificate

## Symptom

`kubectl get nodes` / `kubectl cluster-info` against context `admin@torvalds` fail with:

```
the server has asked for the client to provide credentials
```

## Diagnosis

The Talos API server is reachable and answering — this is an **auth rejection**, not a
down cluster. The kubeconfig user `admin@torvalds` authenticates with an embedded client
certificate (`client-certificate-data`), which has expired.

Decoded cert:

```
subject   = O=system:masters, CN=admin
issuer     = O=kubernetes
notBefore = May 10 21:02:52 2025 GMT
notAfter   = May 10 21:03:02 2026 GMT   <-- expired
```

Today is 2026-05-29 → the admin cert lapsed 19 days ago. Talos issues these admin
kubeconfig certs with a 1-year validity; this one was minted on 2025-05-10.

The cluster itself is healthy (Talos auto-rotates the API server serving certs); only the
locally-held admin credential went stale.

## Fix

Regenerate the admin kubeconfig from Talos (mints a fresh 1-year cert, merges into
`~/.kube/config`):

```bash
talosctl kubeconfig --nodes 192.168.1.81 --force
kubectl get nodes   # verify
```

If `talosctl` itself errors with the same credentials message, its talosconfig client cert
(generated at the same time, same 1-year default) has also expired — regenerate from
`secrets.yaml` (CA is in 1Password):

```bash
cd packages/homelab/src/talos
talosctl gen config --with-secrets secrets.yaml torvalds https://192.168.1.81:6443 --force
```

## Environment notes

- `talosctl` is not installed on the Windows checkout (this box), and there is no
  `~/.talos/config` here. Talos ops are run from another machine; perform the renewal there.
- Control plane endpoint per `packages/homelab/README.md`: `https://192.168.1.81:6443`.

## Session Log — 2026-05-29

### Done

- Diagnosed `the server has asked for the client to provide credentials` on context
  `admin@torvalds` as an expired admin client certificate (`notAfter=May 10 2026`).
- Provided `talosctl kubeconfig --force` remediation plus talosconfig-regen fallback.

### Remaining

- Operator must run the renewal from a machine with `talosctl` + a valid talosconfig.
- Optional: track recurring cert rotation (todo + Temporal report-only warning ~30 days out).

### Caveats

- The talosconfig client cert was likely minted alongside the kubeconfig cert (May 2025) and
  may also be expired; if so, regen from `secrets.yaml` before `talosctl kubeconfig` will work.
- This will recur every ~May unless cert rotation is automated or scheduled.
