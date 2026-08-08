---
title: Plane issue tracker
description: Plane is a private, tailnet-only issue tracker. Argo CD deploys its vendor chart, and durable application state is backed up separately from private attachment storage.
---

Plane is the homelab's private issue tracker. It is reachable only through the
Tailscale ingress at the tailnet's `plane` MagicDNS name; Funnel is not
configured, so the public internet has no route to it. Argo CD deploys both the
vendor application and the local ingress/secrets chart.

## System map

```mermaid
flowchart LR
  accTitle: Plane private deployment
  accDescr: A tailnet member reaches Plane through a Tailscale ingress. The ingress routes requests to the Plane vendor application in its own Kubernetes namespace. Plane keeps databases and queue state on ZFS-backed persistent volumes and stores attachments in a private SeaweedFS S3 bucket through the in-cluster S3 endpoint and Plane storage proxy. Velero backs up the persistent volumes.

  DEV[Tailnet member] --> ING[Tailscale ingress]
  WEB((Public internet)) -.->|no Funnel| ING
  ING --> PLANE[Plane application\nplane namespace]
  PLANE --> PVC[(ZFS persistent volumes)]
  PVC --> VELERO[Velero backups]
  PLANE -->|storage proxy| S3[(Private SeaweedFS\nplane-attachments bucket)]
```

## Why it is shaped this way

- **Tailnet-only access.** The vendor chart's own ingress stays disabled because
  the cluster's Tailscale ingress supplies the private access boundary. It
  routes Plane's path-based services without creating a public endpoint.
- **State has two recovery paths.** PostgreSQL, Redis, RabbitMQ, and monitor
  state live on ZFS persistent volumes and are explicitly included in the
  Velero inventory. Attachments instead live in the private `plane-attachments`
  SeaweedFS bucket, which is protected from accidental destruction by its
  OpenTofu lifecycle policy.
- **Browsers never receive object-store access.** Plane uses its storage proxy
  and the in-cluster S3 endpoint for attachment uploads. The bucket remains
  private, so clients do not need S3 credentials or direct access.
- **GitOps owns deployment.** A local chart creates the namespace, secrets
  integration, and private ingress; a separate Argo CD application installs the
  pinned Plane vendor chart. Changes flow through Git and Argo CD rather than
  direct Kubernetes mutation.

## Where to look

- Private ingress and 1Password secret integration:
  `packages/homelab/src/cdk8s/src/cdk8s-charts/plane.ts`.
- Vendor chart settings, storage proxy, and Argo CD applications:
  `packages/homelab/src/cdk8s/src/resources/argo-applications/plane.ts`.
- Attachment bucket lifecycle policy:
  `packages/homelab/src/tofu/seaweedfs/buckets.tf`.
- Persistent-volume backup inventory:
  `packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json`.
