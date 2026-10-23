---
title: Cut a homelab release
description: How a repository-backed homelab release is published and reconciled, and what to do when a stage fails.
sidebar:
  order: 8
---

Woodpecker verifies source and publishes immutable images, charts and archives.
Delivery records desired and accepted version sets in PostgreSQL and runs the
reviewed deployment pipeline through Temporal. ArgoCD reconciles the frozen
selection. Git contains definitions and policy, with no selected deployment
versions or release commit-back queue.

## Bootstrap Delivery in one maintenance window

Use this procedure only before live Delivery ownership exists. Keep release
mutations paused until the complete catalog and native baselines are ready.
The descriptor in `packages/homelab/scripts/ci/bootstrap-selection.ts`
allows only Woodpecker, Delivery API and Delivery control-plane charts.
Operator-published API/generator images and derived root archives remain
ineligible for ordinary release selection. The control plane instead uses
original CI-qualified artifacts already recorded in PostgreSQL.

1. Obtain green **whole-pipeline CI and required review for the exact PR head**.
   Inspect `toolkit pr health PR` and the native pipeline. Do not substitute an
   image-only workflow, another commit's checks, or a failed producer.
   Before merging, disable the repository's Woodpecker webhook and stop any
   already queued or running old main pipelines. Read back both changes.

   ```bash
   gh api repos/shepherdjerred/monorepo/hooks --jq '.[] | {id, active, url: (.config.url | split("?")[0])}'
   gh api repos/shepherdjerred/monorepo/hooks/WOODPECKER_HOOK_ID --method PATCH -F active=false --silent
   gh api repos/shepherdjerred/monorepo/hooks/WOODPECKER_HOOK_ID --jq '{id, active}'
   toolkit woodpecker pipeline ls shepherdjerred/monorepo
   toolkit woodpecker pipeline stop shepherdjerred/monorepo PIPELINE_NUMBER
   ```

   Select the inspected Woodpecker webhook ID, not an unrelated integration.
   Disable any other source of old main releases during the window. Merge only
   after the real required checks and review pass. Retain the reviewed head SHA.
   For a squash merge, `source-proof` requires its complete Git tree to equal
   the PR's associated merge commit tree. That merge must remain on main.
   Different trees require a source update and renewed CI/review.

2. Replace the generator **before** changing credential locator source. From a
   clean checkout of the reviewed PR head proven integrated into main, use the image-producing
   commands and workload descriptor below, with `targets: ["woodpecker"]`.
   Publish the fixed bootstrap images directly; no main pipeline is needed.
   Run only this first subset:

   ```bash
   toolkit ci source-proof PR --source REVIEWED_HEAD_SHA --json
   bun packages/homelab/scripts/ci/bootstrap-woodpecker.ts /private/woodpecker-bootstrap.json --output /private/woodpecker-preview --dry-run
   bun packages/homelab/scripts/ci/bootstrap-woodpecker.ts /private/woodpecker-bootstrap.json --output /private/woodpecker-apply
   ```

   Pause root automation with the inspected `apps --sync-policy none` command
   below before running this helper. No Delivery Application or registered
   catalog is needed. Verify the generator's actual image digest and baked SHA,
   then re-enable the inspected webhook:

   ```bash
   gh api repos/shepherdjerred/monorepo/hooks/WOODPECKER_HOOK_ID --method PATCH -F active=true --silent
   gh api repos/shepherdjerred/monorepo/hooks/WOODPECKER_HOOK_ID --jq '{id, active}'
   ```

   Run a fresh PR and inspect its generated graph: verification, builds and
   immutable publication only. Keep the old hosted release authority stopped.
   The generated graph must contain no legacy deployment adapters. Before the new CI
   artifact credentials take over, verify their exact storage IAM grants and
   readback through the existing operator storage procedure.

3. Use a clean checkout of the next reviewed PR head proven integrated into main and provision the declared
   prerequisites through their operator OpenTofu wrappers. Apply the tailnet
   policy so the existing Kubernetes operator can assign `tag:delivery` to
   Delivery's Ingress proxy. Keep its admin-only access rules. Delivery uses
   the existing operator identity; no additional Tailscale token or OAuth
   client is needed. Register actual output item IDs in reviewed source,
   never placeholder IDs or copied administrator credentials.

   Before the first image publication, verify the existing separate Docker Hub
   publisher and runtime-reader credentials and their handoffs. Reconcile
   repositories and declared visibility through the operator-only `dockerhub`
   stack. Adopt existing repositories through reviewed imports rather than
   deleting and recreating them. Follow `packages/homelab/src/tofu/dockerhub/README.md`
   for its management credential and encrypted-state prerequisites. Token
   provisioning, when needed, remains in the separate operator-only
   `dockerhub-tokens` stack; account authentication stays outside CI.

   ```bash
   toolkit ci source-proof PR --source REVIEWED_HEAD_SHA --json
   bun packages/homelab/scripts/tofu/tofu-stack.ts tailscale plan
   bun packages/homelab/scripts/tofu/tofu-stack.ts tailscale apply
   ```

   Any source change needs its own exact CI/review proof before bootstrap.
   Use the existing credential broker and service-account wrapper; never put
   credential values in descriptors, shell arguments or receipts.

4. Pause root and Argo's own automatic reconciliation before the account
   prerequisite. Inspect their exact native identities first.

   ```bash
   toolkit argocd app get apps -o json
   toolkit argocd app get argocd -o json
   toolkit argocd app set apps --sync-policy none
   toolkit argocd app set argocd --sync-policy none
   ```

   The bootstrap classifier permits only these maintenance pauses and the exact
   reviewed Delivery account change. Unrelated Application or shared-resource
   drift fails closed. The live default RBAC role must already be empty.

5. Create an external account request containing `schema`, `sourceRevision`,
   `pullRequest` and a fresh `requestId` UUID:

   ```json
   {
     "schema": "delivery-argocd-account-bootstrap/v1",
     "sourceRevision": "REVIEWED_40_CHARACTER_HEAD_SHA",
     "pullRequest": 123,
     "requestId": "FRESH_REQUEST_UUID"
   }
   ```

   Run through the existing service-account wrapper with **distinct** operator
   and root credentials. The helper independently reads their native usernames:
   `ARGOCD_TOKEN` must be the existing operator `admin`; `ROOT_ARGOCD_TOKEN`
   must be legacy `woodpecker` or dedicated `delivery-platform`. The operator
   performs only preownership inspection and child/account CAS. The guarded root
   subprocess receives only the root token, never the operator credential.
   These references contain no credential values:

   ```bash
   ARGOCD_TOKEN='op://v64ocnykdqju4ui6j6pua56xw4/yikdwue26c7gdbk5ftbvaclkli/ARGOCD_AUTH_TOKEN' ROOT_ARGOCD_TOKEN='op://v64ocnykdqju4ui6j6pua56xw4/ga3ma76q6vw2bxeyvkqj4xaucy/ARGOCD_AUTH_TOKEN' scripts/onepassword/with-service-account.sh op run -- env -u OP_SERVICE_ACCOUNT_TOKEN bun packages/homelab/scripts/ci/bootstrap-argocd-accounts.ts /private/account-request.json --output /private/account-preview --dry-run
   ```

   Use this same credential separation for the workload bootstrap. Output
   directories must be new, private and outside the checkout.

   ```bash
   bun packages/homelab/scripts/ci/bootstrap-argocd-accounts.ts /private/account-request.json --output /private/account-preview --dry-run
   bun packages/homelab/scripts/ci/bootstrap-argocd-accounts.ts /private/account-request.json --output /private/account-apply
   bun packages/homelab/scripts/tofu/tofu-stack.ts argocd plan
   bun packages/homelab/scripts/tofu/tofu-stack.ts argocd apply
   ```

   The helper preserves the running Argo repository, chart and revision. It
   changes only the three reviewed account definitions and their principal
   rows, then records the owned finished sync UUID. OpenTofu issues the scoped
   tokens afterwards. Register those output IDs in reviewed source before
   building the control plane. That OpenTofu step retires the old Woodpecker
   token/item. For subsequent API/control-plane bootstrap, resolve
   `ROOT_ARGOCD_TOKEN` from the newly issued `delivery-platform` item; retain
   the separate operator reference for preownership CAS. No administrator-token
   fallback exists for guarded root operations.
   For API bootstrap, also inject `ARGOCD_WORKLOAD_TOKEN` from the issued
   `delivery` application-account item. The helper independently verifies that
   principal and uses it for needed workload child reconciliation; the platform
   account retains root and control-plane operations. A root account cannot
   substitute for the application credential, or an administrator for either.

6. Build the two operator bootstrap images directly from the proven source.
   PR pipelines do not publish them, and old main automation is stopped.
   Use the existing Docker credential store and a fresh `2.0.0-N` version
   whose tags do not already exist. Set `SOURCE_SHA`, `BOOTSTRAP_VERSION` and
   `BOOTSTRAP_DIR` to the inspected source, chosen version and private directory.

   ```bash
   GIT_SHA="$SOURCE_SHA" VERSION="$BOOTSTRAP_VERSION" docker buildx bake woodpecker-config-extension delivery --set '*.platform=linux/amd64' --set '*.target=smoke' --set '*.output=type=cacheonly'
   GIT_SHA="$SOURCE_SHA" VERSION="$BOOTSTRAP_VERSION" docker buildx bake woodpecker-config-extension delivery --set '*.platform=linux/amd64' --set "woodpecker-config-extension.tags=docker.io/shepherdjerred/woodpecker-config-extension:$BOOTSTRAP_VERSION" --set "delivery.tags=docker.io/shepherdjerred/delivery:$BOOTSTRAP_VERSION" --metadata-file "$BOOTSTRAP_DIR/images.json" --push
   ```

   Retain native build metadata and registry manifest digests. The descriptor's
   source SHA and version must match each image's baked `GIT_SHA` and `VERSION`.
   These are truthful operator bootstrap publications, not CI-qualified builds.
   Do not invoke CI handoff writers or invent a pipeline number for them.

7. Create an external workload descriptor. Replace the illustrative strings
   with actual source, immutable digests, version and a fresh UUID:

   ```json
   {
     "schema": "delivery-bootstrap/v1",
     "sourceRevision": "REVIEWED_40_CHARACTER_HEAD_SHA",
     "pullRequest": 123,
     "revision": "2.0.0-UNUSED_CHART_NUMBER",
     "requestId": "FRESH_REQUEST_UUID",
     "targets": ["woodpecker", "delivery"],
     "images": {
       "woodpecker": {
         "repository": "docker.io/shepherdjerred/woodpecker-config-extension",
         "digest": "sha256:ACTUAL_MANIFEST_DIGEST",
         "version": "2.0.0-IMAGE_NUMBER",
         "sourceRevision": "REVIEWED_40_CHARACTER_HEAD_SHA"
       },
       "delivery": {
         "repository": "docker.io/shepherdjerred/delivery",
         "digest": "sha256:ACTUAL_MANIFEST_DIGEST",
         "version": "2.0.0-IMAGE_NUMBER",
         "sourceRevision": "REVIEWED_40_CHARACTER_HEAD_SHA"
       }
     }
   }
   ```

   Resolve the separate operator/root tokens and ChartMuseum publication credentials through their
   existing wrapper. Run a preview, inspect its immutable archive inventory,
   then execute with a different new output directory:

   ```bash
   bun packages/homelab/scripts/ci/bootstrap-woodpecker.ts /private/bootstrap.json --output /private/bootstrap-preview --dry-run
   bun packages/homelab/scripts/ci/bootstrap-woodpecker.ts /private/bootstrap.json --output /private/bootstrap-api
   ```

   The helper derives an immutable root archive from the captured native root.
   It preserves every unrelated child source, lifecycle and shared resource,
   including Forum's existing chart without the new seven selected parameters.
   It publishes only the selected fixed children and this derived root, then
   uses the normal exact-revision `release-root` lifecycle.

8. Verify API readiness, PostgreSQL migrations and private authentication. Do
   **not register catalog environments yet**. Keep dispatch paused and temporarily
   enable API catalog writes for publication and qualification. With no registered
   environment, those records cannot dispatch a release. Let the publication-only main
   pipeline publish and register the genuine Temporal image and separate
   control-plane chart. Wait for its whole native pipeline to succeed, then
   qualify those actual build records through the API's independent CI verifier:

   ```bash
   toolkit deploy qualify IMAGE_BUILD_ID --machine --json
   toolkit deploy qualify CHART_BUILD_ID --machine --json
   ```

   This uses the execute credential and exact native main-push CI evidence;
   it needs no running Temporal worker or dispatch Schedule. A failed producer
   cannot be qualified. Keep each artifact's original producing source/build,
   even when it differs from the reviewed bootstrap procedure source.

   Create exact qualified-artifact queries containing
   `{serviceId, component, kind, digest, version, originKind: "first-party"}`.
   The image role is `temporal` / `image:temporal-worker` / `image`; the chart
   role is `delivery-control-plane` / `chart:delivery-control-plane` / `chart`.
   Resolve their original records through the authenticated catalog:

   ```bash
   toolkit deploy artifact --file /private/cp-image-query.json --machine --json > /private/cp-image.json
   toolkit deploy artifact --file /private/cp-chart-query.json --machine --json > /private/cp-chart.json
   ```

   Use a second descriptor targeting only `delivery-control-plane`, with a new
   **root archive** revision/request UUID and canonical `deliveryUrl`. Add
   `controlPlane: {image: ORIGINAL_IMAGE_RECORD, chart: ORIGINAL_CHART_RECORD}`
   from these results. The helper independently rechecks qualification and
   original identities, archive bytes and image provenance. Every image platform
   must declare the `delivery-control-plane/v2` capability, which includes the
   dedicated Delivery Workflow poller; an older Activity-only image is refused.
   It selects the
   original CP chart URI/version/digest and image; it never repackages the CP
   child chart into the operator root revision. Preserve both original IDs in
   the receipt for the first managed upgrade's `previousImageArtifactId` and
   `priorChartArtifactId` inputs. The initial managed-upgrade contract expects
   this installer's explicit image Helm selection; the independent Job verifies
   that exact native shape before effects.
   Subsequent upgrades derive their prior selection from immutable acceptance.
   No accepted deployment is invented for bootstrap.

   The existing API must independently report an empty environment catalog;
   inspection failure or any registered environment blocks bootstrap. Artifact
   and build registration/qualification are permitted before this transfer.
   Restore the global write pause before the control-plane bootstrap.

   Install the source-declared dispatch Schedule on the dedicated queue, paused
   from its first creation. Use the supported Temporal CLI, not the old central
   worker's Schedule inventory:

   ```bash
   toolkit temporal --namespace prod schedule create --schedule-id delivery-dispatch --type deliveryDispatchWorkflow --task-queue delivery-workflows --interval 1m --overlap-policy Skip --execution-timeout 5m --catchup-window 5m --paused --notes 'Awaiting Delivery ownership transfer'
   toolkit temporal --namespace prod schedule describe --schedule-id delivery-dispatch
   ```

   If the Schedule already exists, inspect its exact type, dedicated queue and
   paused state before continuing; do not create a second Schedule or trigger
   it. Start the required baseline Workflows explicitly as shown below while
   this Schedule remains paused. The three steady control-plane
   roles request 300m CPU and 768 MiB; their combined limits are 3 CPU and 3 GiB.

9. With API and control-plane hosts ready, seed genuine qualified publication
   provenance and inspect actual current runtime. Establish worker host-only
   adoption and Forum's read-only native baseline before new releases. Bootstrap
   receipts do not create accepted VersionSets or eligible artifacts.
   Keep the dispatch Schedule paused while seeding. Run only required read-only
   baseline Workflows explicitly, and wait for their native evidence:

   ```bash
   toolkit deploy workers baseline --file /private/worker-baseline.json --machine --json
   toolkit deploy forum baseline --file /private/forum-baseline.json --machine --json
   ```

   These commands record pending intents; a paused Schedule does not dispatch
   them. Inspect each returned intent and start only its exact recorded
   Workflow ID, with the corresponding actual deployment/intent ID:

   ```bash
   toolkit temporal --namespace prod workflow start --workflow-id ACTUAL_WORKER_BASELINE_WORKFLOW_ID --type deliveryDeploymentWorkflow --task-queue delivery-workflows --input '{"deploymentId":"ACTUAL_WORKER_BASELINE_DEPLOYMENT_ID"}'
   toolkit temporal --namespace prod workflow start --workflow-id ACTUAL_FORUM_BASELINE_WORKFLOW_ID --type deliveryForumBaselineWorkflow --task-queue delivery-workflows --input '{"intentId":"ACTUAL_FORUM_BASELINE_INTENT_ID"}'
   ```

   Read back each run before retrying; never invent a replacement Workflow ID.
   Wait for native baseline settlement before handover. For subsequent
   control-plane upgrades, pause dispatch and drain all other pending releases,
   baselines and recoveries first. The upgrade's native Job stops the journaled
   ordinary Activity host, proves the dedicated queue contains only its exact
   own run, and replays its unchanged history against the qualified candidate
   source before selection. The selected chart must restore every host to its
   declared replica count. A failed preselection restores only the same prior
   UID/template; crash recovery uses the same durable journal.
   Because dispatch remains paused, start that upgrade's returned stable
   Workflow ID explicitly as well:

   ```bash
   toolkit temporal --namespace prod workflow start --workflow-id delivery/ACTUAL_CONTROL_PLANE_DEPLOYMENT_ID --type deliveryDeploymentWorkflow --task-queue delivery-workflows --input '{"deploymentId":"ACTUAL_CONTROL_PLANE_DEPLOYMENT_ID"}'
   ```

   Pause global Delivery writes after those requests settle. Disable the exact
   Woodpecker webhook again and stop queued/running native pipelines for the
   brief ownership transfer. Inspect the authenticated, source-bound context:

   ```bash
   toolkit deploy handover-context --machine --json
   ```

   Prepare an external `delivery-ownership-handover/v1` descriptor with the
   exact reviewed `sourceRevision`, the `catalogRevision` that
   `toolkit deploy catalog reconcile` reported for the reviewed checkout's
   catalog (never copied from the context), `pullRequest`, fresh `requestId`, canonical
   `deliveryUrl`, inspected `woodpeckerWebhookId`, and **every catalog target**:
   `targets: [{application, environmentId, expectedGeneration}]`. Copy actual
   generations from the context. Worker targets require their original retained
   host baseline; unaccepted Forum targets require their native runtime baseline.
   This initial cutover requires every target to be ready together. If any
   baseline, credential or prerequisite is unavailable, leave release authority
   stopped and complete it before transferring ownership or enabling dispatch;
   do not select a rolling subset.

   ```bash
   bun packages/homelab/scripts/ci/delivery-handover.ts /private/handover.json --output /private/handover-preview --dry-run
   bun packages/homelab/scripts/ci/delivery-handover.ts /private/handover.json --output /private/handover-apply
   ```

   The handover uses issued, source-registered workload/platform accounts,
   independently checks their actual identities and permissions, and preserves
   each complete native source while adding PG ownership and disabling autosync.
   Fresh paused admission, zero pending requests/locks and stable baselines are
   required before every UID/resource-version CAS. It never records acceptance.
   Retain its private receipt if interrupted; leave both mutation systems paused
   while inspecting exact native metadata and the recorded intent.

   Transfer all ready authority together, enable the declarative dispatch
   Schedule, and verify the first actual releases. Re-enable the inspected
   publication-only webhook after handover.
   Remove old deployment credentials; keep Woodpecker
   limited to verification and immutable artifact production.

If interrupted, retain the private descriptor, receipt, archives and
`expected.json`. Inspect the recorded UID/source and owned operation before
continuing. After `root-release-intent`, resume **the same** existing root
request using its recorded revision and expected inventory:

```bash
bun packages/homelab/scripts/argocd/argocd.ts release-root apps /private/bootstrap-api/expected.json --revision RECORDED_REVISION --request-id RECORDED_REQUEST_UUID
```

Do not rerun the whole bootstrap with a new identity, overwrite an immutable
archive, or treat a missing response as failure-before-effect. Before root
submission, inspect exact publication and source-freeze receipts and resolve
the recorded step under the same maintenance ownership. After real PG/native
ownership exists, use independent Delivery recovery instead of bootstrap.

## Inspect and request a release

1. Inspect the environment in Delivery and list its qualified versions:

   ```bash
   toolkit deploy versions SERVICE --json
   ```

   Inspect desired, observed and accepted versions separately. A pending or
   rejected build is not an eligible release. Automatic environments queue the
   latest qualified candidate; Scout and Starlight production require human
   approval of the exact frozen request.

2. Request an explicit version set when an operator selection is needed:

   ```bash
   toolkit deploy start ENVIRONMENT VERSION_SET --json
   toolkit deploy wait DEPLOYMENT_ID --timeout 86400 --json
   ```

   The UI shows each stage, blocker and evidence. A successful build does not
   prove reconciliation or runtime acceptance. Retry retains the selected
   artifacts; rollback selects a previously accepted set. Forum and Minecraft
   require their preservation and restoration procedures rather than a blind
   image reversal.

3. For a failed operation, inspect its recorded effects before retrying:

   ```bash
   toolkit deploy status DEPLOYMENT_ID --json
   ```

   A retained lock protects ambiguous external writes. Stop the old executor
   and use the corresponding independent recovery procedure. Do not remove a
   database lock or replace a foreign active Argo operation.

## If an image did not rebuild

The image workflow compares source against the most recent complete publication
whose source is an ancestor of the current build. It retains unchanged image
identities from the durable publication inventory. Neither deployment success
nor a Git commit-back branch controls artifact reuse.

Inspect the image workflow's comparison base, changed paths, target reasons and
push outcomes. Missing publication evidence rebuilds the required image closure;
corrupt or conflicting evidence fails the producer. Bootstrap a new service by
publishing and qualifying its actual image before requesting its deployment.

## Recover a Delivery operation

Use this procedure for a failed or canceled delegated application deployment
whose Delivery details show `recoveryRequired`. It also covers a stopped worker
that recorded intent before selecting the chart or submitting an Argo operation.
For a site, Scout frontend, or forum release, use
[content recovery](#recover-a-site-or-forum-release) instead. Specialized worker
recovery retains its separate native proof. The generic helper refuses these targets.

1. Pause Delivery mutations. Confirm the old Workflow is closed and its mutation
   executor is stopped through the repository-owned worker deployment path.
   A closed Workflow alone does not prove an Activity process has stopped.
2. Inspect the retained target and recorded reconciliation request:

   ```bash
   toolkit deploy status DEPLOYMENT_ID --machine --json
   ```

   Keep its `environment.generation` as `GENERATION` for step 6. The
   [deployment detail contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/shared/contract.ts)
   defines that field. The service
   [refuses the recovery](https://github.com/shepherdjerred/monorepo/blob/main/packages/toolkit/README.md#delivery)
   once the environment generation changes.

3. Export the frozen artifact and configuration selection for review:

   ```bash
   bun packages/temporal/scripts/recovery/delivery.ts export DEPLOYMENT_ID --file /tmp/delivery-recovery.json
   ```

   The helper requires the failed or canceled deployment to retain its original
   environment lock. It verifies the recorded stage request and rejects credential
   parameter keys. Inspect the application, chart digest, image digests, request
   ID, and non-secret configuration in this file.

4. Settle that exact selection while Delivery retains ownership:

   ```bash
   bun packages/temporal/scripts/recovery/delivery.ts settle DEPLOYMENT_ID --file /tmp/delivery-recovery.json
   ```

   The helper rereads Delivery before using the credential broker. It invokes
   `sync-managed` with an explicit `--delivery-selection` file, exact revision,
   and recorded request ID. The command verifies the chart digest, root field
   preservation, delegation, inactive operations, and resource-version tests
   before selecting the source. Existing apply-safety and operation-ownership
   checks still govern the bounded sync. There is no pruning or acceptance write.

5. Read the finished operation UUID from the application named in the export:

   ```bash
   toolkit argocd app get APPLICATION -o json | jq -er '.status.operationState.operation.info[] | select(.name == "ci.sjer.red/operation-id") | .value'
   ```

6. Release ownership through independent observation:

   ```bash
   toolkit deploy recover DEPLOYMENT_ID --expected-generation GENERATION --operation-id ARGO_OPERATION_UUID --reason "Inspected and settled the exact frozen release with the prior executor stopped" --machine
   ```

   This remains available while writes are paused and Temporal is unavailable.
   The API requires the matching finished request, operation UUID, environment
   delegation, and settled Jobs. Recovery clears ownership; it does not mark the
   failed deployment accepted. Request a new deployment to perform acceptance.

If any check fails, retain the lock and inspect that exact external operation.
Do not delete database locks or replace a foreign active operation.

## Recover a site or forum release

Use a separate recovery intent when a failed or canceled site, Scout frontend,
or forum release retains its lock. Recovery settles native effects without
accepting the failed deployment or changing its accepted release.

1. Pause the Delivery dispatcher Schedule and drain other running releases and
   recovery operations. Inspect the held deployment:

   ```bash
   toolkit deploy status DEPLOYMENT_ID --machine --json
   ```

   Keep its exact environment generation, selected artifacts, pipeline and
   recorded operations. Leave the ordinary Activity host at one replica: the
   maintenance command journals its exact identity before stopping it. A closed
   Workflow alone does not prove its executor stopped.

2. Request inspection with the admin credential and that exact generation:

   ```bash
   toolkit deploy sites recover DEPLOYMENT_ID --machine --expected-generation GENERATION --reason "Inspect and settle the exact frozen site release under retained ownership"
   ```

   For a forum release, replace `sites` with `forum`. Retain the returned intent
   ID and request ID. The caller supplies no native proof or replacement artifacts.

3. Inspect the intent and its native receipts:

   ```bash
   toolkit deploy sites recovery INTENT_ID --machine --json
   ```

   Use `forum recovery` for the forum. The UI shows the same frozen operation,
   native Job identities and refusal reasons. Repair uses the frozen archive or
   forum release inputs. It cannot reverse a database upgrade or remove another
   execution's maintenance lock.

4. Run the one-shot maintenance command with the existing operator context:

   ```bash
   bun packages/temporal/scripts/rollout/content-delivery-recovery.ts --intent INTENT_ID --action inspect --context admin@torvalds --url https://delivery.tailnet-1a49.ts.net
   ```

   `inspect` settles only an already verified desired release. If repair is
   needed, review the refusal and rerun with `--action repair`. Repair uses the
   frozen archive or same forum candidate; it retains the original backup.
   The command stops the journaled Activity host, checks the original executor
   and native Jobs, verifies the result, then restores that exact host. It does
   not create an automatic recovery Workflow or controller.

   If an interrupted forum `install`, `addons`, `seed`, `history` or `accounts`
   step cannot be retried safely, retain the reported step and journal SHA-256.
   Keep maintenance active. Check the terminal original Pod's UID, image and
   owning Job UID against the frozen receipt before copying it for native repair.
   Preserve its original image, environment, PVCs and init containers. For
   example, after reviewing the native history checkpoints:

   ```bash
   kubectl --context admin@torvalds -n FORUM_NAMESPACE debug ORIGINAL_POD --copy-to=MANUAL_REPAIR_POD --container=release --keep-init-containers=true --keep-labels=true --profile=restricted --share-processes=false -- php /opt/storm-forum/runtime/command.php storm:history --migrate
   ```

   Use the corresponding native command for reviewed seed or account repair.
   Diagnose installation and add-on state with XenForo's native recovery tools;
   do not blindly rerun a migration or delete a pending merge marker.
   Wait for the exact manual Pod to terminate and retain its result. Read its
   current UID and resource version, then remove only that Pod:

   ```bash
   kubectl --context admin@torvalds -n FORUM_NAMESPACE get pod MANUAL_REPAIR_POD -o jsonpath='{.metadata.uid}{" "}{.metadata.resourceVersion}{" "}{.status.phase}{"\n"}'
   kubectl --context admin@torvalds delete --raw /api/v1/namespaces/FORUM_NAMESPACE/pods/MANUAL_REPAIR_POD -f - <<'JSON'
   {"apiVersion":"v1","kind":"DeleteOptions","preconditions":{"uid":"MANUAL_POD_UID","resourceVersion":"MANUAL_POD_RESOURCE_VERSION"},"propagationPolicy":"Foreground"}
   JSON
   ```

   Require its deletion before acknowledging the same interrupted step and
   exact journal hash:

   ```bash
   bun packages/temporal/scripts/rollout/content-delivery-recovery.ts --intent INTENT_ID --action repair --acknowledge-step STEP --expected-journal-sha256 JOURNAL_SHA256 --context admin@torvalds --url https://delivery.tailnet-1a49.ts.net
   ```

   Fixed read-only native checks must prove completion before that one
   checkpoint is appended. A failed check keeps the owner, backup and journal.

5. Confirm independent settlement succeeded and the original failed result and
   accepted pointers remain unchanged. A failed or refused recovery retains
   ownership; inspect its exact reason before requesting another attempt.

   If `dispatchBarrier` is present, also require `barrierRestoredAt` before
   resuming dispatch. A terminal recovery status alone does not prove that its
   journaled producer host has been restored.

   If interrupted, rerun the same command and intent. Do not create a new
   journal or manually scale the producer to bypass its identity checks.

Do not use generic `deploy recover` or delete PostgreSQL locks for these targets.

## Where it lives

The reviewed execution contracts are documented in `packages/delivery/README.md`
and the
[Temporal worker](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/README.md).

## Related

- [Why the release pipeline is shaped this way](/explanation/homelab/release-safety/)
- [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
