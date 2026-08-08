---
id: plane-commercial-issue-tracker
type: plan
status: in-progress
board: false
verification: operator
disposition: active
---

# Self-host Plane Commercial as a private issue tracker

## Summary

Deploy the free Plane Commercial tier with the official `plane-enterprise`
Helm chart, pinned to chart `3.1.0` and app `v3.0.1`. Use Plane for private
issue tracking only; leave wiki/pages available but unused. Access is through
the Tailscale Kubernetes ingress at `plane.tailnet-1a49.ts.net`, with no public
Funnel exposure.

## Implementation

- Pin the vendor chart and app versions and generate the typed Helm values.
- Add the Plane CDK8s chart with the private ingress and a 1Password-backed
  `plane-secrets` Kubernetes Secret.
- Keep the bundled stateful dependencies in a namespace with explicit
  privileged PSA enforcement and restricted audit/warn visibility. Keep the
  repository chart Application named `plane` for release inventory alignment;
  the release controller explicitly syncs it, while the vendor Application is
  named `plane-enterprise` and retains the `plane` Helm release name.
- Add layered Argo CD applications: one for the local infrastructure chart and
  one sourcing `plane-enterprise` from `https://helm.plane.so/`.
- Disable the vendor ingress, AI/PI, runner, local MinIO, and local OpenSearch.
- Use local Postgres, Redis, and RabbitMQ on `zfs-ssd`.
- Store attachments in the SeaweedFS S3 bucket `plane-attachments` through the
  in-cluster S3 endpoint and Plane storage proxy.
- Add the stateful Plane PVCs to the explicit Velero backup inventory.

## Verification completed

- [x] Generate the vendor Helm types.
- [x] Synthesize the CDK8s output.
- [x] Render the vendor chart with the synthesized values.
- [x] Create the dedicated 1Password item without storing credentials in Git.
- [x] Validate the 1Password item references against the vault snapshot.
- [x] Add focused synthesis assertions for the Argo values and private routes.

## Remaining

- [ ] Publish the local `plane` chart and let Argo CD reconcile both
      applications.
- [ ] Confirm Argo CD reports Plane synced and healthy.
- [ ] Exercise native login, workspace/project/issue/cycle/comment workflows,
      attachment persistence, and tailnet-only access.
- [ ] Confirm Velero discovers the Plane Postgres, Redis, RabbitMQ, and monitor
      PVCs.

SMTP, OAuth, and SSO remain deferred until the issue-tracking deployment is
validated.
