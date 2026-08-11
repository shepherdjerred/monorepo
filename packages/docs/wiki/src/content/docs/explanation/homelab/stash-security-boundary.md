---
title: Why Stash has two access barriers
description: Stash combines a tailnet-only route with built-in credentials because network identity and application authentication cover different failures.
---

Stash is a private media organizer with two independent access barriers. The
tailnet controls who can reach it, while built-in credentials control who can
open the application.

```mermaid
flowchart LR
  accTitle: Stash access and persistence boundaries
  accDescr: A tailnet member reaches the private Tailscale ingress over HTTPS, then signs in through Stash's built-in authentication. Stash keeps durable state, generated assets, and the personal media library on three isolated ZFS volumes. Velero protects each volume.

  USER[Tailnet member] -->|private HTTPS| TS[Tailscale ingress]
  TS --> AUTH[Built-in authentication]
  AUTH --> APP[Stash]
  APP --> STATE[(State)]
  APP --> GEN[(Generated assets)]
  APP --> MEDIA[(Personal media library)]
  STATE --> BACKUP[Velero backups]
  GEN --> BACKUP
  MEDIA --> BACKUP
```

## Why the barriers are separate

Tailscale limits network reachability to enrolled devices. It does not prove
that the person using an unlocked device should see this service.

Stash's credentials add an application session boundary. They are written into
the persistent configuration before the app starts, so there is no first-run
window without authentication.

The plaintext password remains in 1Password for operator access. The workload
receives only the username and bcrypt hash through an init container. The main
container receives neither credential field.

## Why storage is isolated

The service does not reuse the broad media namespace or its shared claims.
Configuration, generated assets, and the personal library have distinct volume
lifecycles and capacity profiles.

All three claims are listed explicitly in the backup inventory. This makes
missing coverage a synthesis failure instead of an operational assumption.

Phase one protects recoverability, not confidentiality at rest. The local ZFS
datasets and backup stream retain the homelab's existing unencrypted posture.
That risk is temporary and explicit; encryption needs a separate migration and
key-recovery design that preserves the initial recovery points.

## Why the first deployment is exceptional

The workload is bootstrapped once from the exact synthesized chart manifest so
its private access and authentication can be accepted before review. The same
change also defines the internal chart and ArgoCD Application.

After the chart is published and ArgoCD adopts the resources, direct apply is
no longer an ownership path. Later changes use the normal release flow.

## Where to look

- Workload boundary: `src/cdk8s/src/resources/stash/`
- ArgoCD ownership: `src/cdk8s/src/resources/argo-applications/stash.ts`
- Backup inventory: `src/cdk8s/src/backup-policy/pvc-backup-policy.json`
- Deployment decisions: `packages/docs/plans/2026-08-10_stash-tailnet-deployment.md`
