---
title: Recover The Storm mining reset
description: Inspect and recover a paused quarterly reset without risking the main Minecraft world.
---

Recover a failed mining reset by inspecting its exact Temporal run, Velero Backup, and Kubernetes Job before releasing the server lock.

The [quarterly schedule](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions.ts) is initially paused. Keep it paused until the backup restore and reset Job have been rehearsed on disposable storage, and the live world rollout has been accepted.

1. Inspect the `the-storm-mining-reset-quarterly` schedule in Temporal namespace `prod`. Record the Workflow ID and run ID. Confirm the infra worker on its isolated `mining-reset` queue handled the Activity. Read the failure and heartbeat phase before touching Kubernetes.

2. Read the `minecraft-tsmc` StatefulSet and Service in namespace `minecraft-tsmc`. The maintenance lock is `sjer.red/mining-reset-lock` on the StatefulSet; `sjer.red/mining-reset-image` pins the Job image across Activity retries. The Service carries `mc-router.itzg.me/autoScaleUp=false` during the reset. Keep the StatefulSet at zero replicas and confirm no ordinary server Pod exists. The [admission guard](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/cdk8s-charts/apps.ts) rejects scale-up while the lock is present.

   If a world restoration owns the server, await that operator. The
   [mining Activity](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/homelab/mining-reset.ts)
   defers before creating a backup, reset Job, or router change. Do not release
   another request's lease to resume a mining reset.

3. Read the matching `mining-reset-YYYYqN` Backup in namespace `velero`. Require phase `Completed`, zero warnings and errors, and exactly one attempted and completed volume snapshot. The [PVC policy](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json) includes `datadir-minecraft-tsmc-0`. A completed backup is still separate from a tested restore.

4. Read the matching `mining-reset-YYYYqN` Job in namespace `minecraft-tsmc`. A terminally failed Job is deleted and recreated by the Activity only after its exact command, image, quarter, and PVC are validated; inspect repeated failures and Pod logs before manual intervention. The Job atomically renames `/data/mining` to `/data/.mining-reset/YYYYqN.deleting`, removes the contents, installs `.mining-reset/YYYYqN.done`, then removes the empty checkpoint. A retry resumes deletion even if the checkpoint is empty and leaves any newly regenerated `/data/mining` alone. Do not substitute a different Job or PVC.

5. If the server is still occupied at the scheduled time, the Workflow waits in five-minute durable steps for up to four hours without taking a lock or backup. If it is still occupied after that window, the Workflow fails visibly. If the Workflow is running a reset, let its retry continue only when the Backup and Job match the intended quarter and claim. If the Workflow failed or either object has an unexpected spec, leave the lock in place for a controlled recovery. After a successful Workflow completion, confirm the lock, pinned image, and router maintenance annotations are gone before allowing a client to wake the server.

## Related

- [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
