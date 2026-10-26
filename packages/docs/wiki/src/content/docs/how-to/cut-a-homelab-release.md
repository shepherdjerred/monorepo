---
title: Cut a homelab release
description: Deploy, promote, rebind and roll back a Delivery environment, decide approvals and OpenTofu plans, publish to a channel, register catalog changes, attest operator-run deployments, and recover a held deployment.
sidebar:
  order: 8
---

Use these procedures to change what a homelab environment runs. Every step is a
`toolkit deploy` command against the Delivery API.

The [Delivery model reference](/reference/delivery-model/) lists each command's
route, scope and credential, and the kinds and states it reports. The
[toolkit deploy command](packages/toolkit/src/commands/deploy/deploy.ts) prints
the same list with `toolkit deploy --help`.

:::note
Commands without `--machine` use your Tailscale identity. `--machine` uses a
brokered machine credential. Machine credentials never approve a deployment or
decide a plan.
:::

## Deploy a set revision

An automatic environment without a promotion source receives each new set
revision by itself ([section 6](packages/delivery/docs/model.md#6-flows)). Use
this procedure to choose one explicitly.

1. List the service's set revisions and pick one:

   ```bash
   toolkit deploy versions SERVICE --json
   ```

   A set revision is eligible when it is in the current lineage, every build is
   verified, every prerequisite edge holds and, with a promotion source, it is
   accepted there ([eligibility](packages/delivery/docs/model.md#412-deployment)).

2. Request the deployment. It keeps the environment's accepted recipe and
   configuration. For a channel or operator-run recipe, `start` requests that
   kind instead:

   ```bash
   toolkit deploy start ENVIRONMENT SET_REVISION --json
   ```

   Delivery refuses a non-eligible set revision and names each reason. To
   deploy it anyway, add `--override`. The deployment then waits for an
   override approval ([H4](packages/delivery/docs/model.md#413-approval)).

3. If the environment's approval policy is `required`, or you asked for an
   override, decide it from a human session. Add `--override` to decide an
   override:

   ```bash
   toolkit deploy approve DEPLOYMENT_ID --reason "Reviewed the frozen selection"
   ```

   A deployment has one approval. `toolkit deploy reject` with a reason
   decides it the other way. An OpenTofu stack takes its decision on the
   saved plan instead; see
   [Approve or reject an OpenTofu plan](#approve-or-reject-an-opentofu-plan).

4. Wait for acceptance. Exit code 1 means failed or canceled; 2 means the
   deadline passed:

   ```bash
   toolkit deploy wait DEPLOYMENT_ID --timeout 3600 --json
   ```

5. Watch the monitor until it reports `settled` or `unmonitored`:

   ```bash
   toolkit deploy monitor ENVIRONMENT --json
   ```

   If it reports `alarmed`, follow
   [Respond to an alarmed monitor](#respond-to-an-alarmed-monitor).

## Promote from beta or a qualification environment

1. Confirm the source environment's monitor is `settled` or `unmonitored`.
   Promotion refuses any other source
   ([W3](packages/delivery/docs/model.md#419-monitor)):

   ```bash
   toolkit deploy monitor SOURCE_ENVIRONMENT --json
   ```

   For `minecraft/sandbox`, acceptance itself requires the qualification
   suites' `test` evidence
   ([V5](packages/delivery/docs/model.md#414-acceptance)).

2. Promote the source's accepted set revision:

   ```bash
   toolkit deploy promote SOURCE_ENVIRONMENT DESTINATION_ENVIRONMENT --json
   ```

3. Approve if required, then wait and watch the monitor as in
   [Deploy a set revision](#deploy-a-set-revision).

## Approve or reject an OpenTofu plan

A `tofu` recipe with an approve step takes its one approval there, on the
saved plan ([H6](packages/delivery/docs/model.md#413-approval)). Its selection
is never approved on its own.

1. Wait until the deployment's approve step is waiting, then read the saved
   plan's digest, expiry, state serial and change summary:

   ```bash
   toolkit deploy status DEPLOYMENT_ID --json
   ```

   The hub's deployment page shows the same plan beside its selection.

2. Approve that exact plan from a human session:

   ```bash
   toolkit deploy approve-plan DEPLOYMENT_ID --reason "Reviewed the saved plan's changes"
   ```

   The command reads the digest from the deployment's own saved plan. The apply
   step then consumes that plan once.

3. To refuse it instead, reject the plan:

   ```bash
   toolkit deploy reject-plan DEPLOYMENT_ID --reason "Why the saved plan must not apply"
   ```

   Delivery discards the plan. The deployment ends failed without applying and
   releases its locks.

An override of a non-eligible OpenTofu deployment is decided first, with
`toolkit deploy approve --override`, before the plan runs. The approval expires
if the plan expires or the binding generation moves before you decide.

## Publish to a channel

A `channel` environment, such as an npm dist-tag, publishes a version to an
audience ([X12](packages/delivery/docs/model.md#9-decisions)).

1. Request the release. `start` sends a `channel-publish` deployment for a
   channel recipe:

   ```bash
   toolkit deploy start CHANNEL_ENVIRONMENT SET_REVISION --json
   ```

2. Wait for acceptance as in [Deploy a set revision](#deploy-a-set-revision).
   The deployment publishes the version if the store lacks it, moves the
   channel's pointer, and reads back the registry's bytes and pointer
   ([section 5](packages/delivery/docs/model.md#5-target-kinds)).

A published version is never removed. Rolling a channel back
[from its candidates](#roll-back-an-environment) moves only the pointer. A
`forwardOnly` channel lists no eligible candidate. Delivery has an adapter for
npm only; a channel on another store fails without an effect.

## Register a catalog change

Use this after merging a change to services, environments, edges, recipes or
configurations.

1. From the repository root at the merged commit, post the catalog document:

   ```bash
   toolkit deploy catalog reconcile --file CATALOG_DOCUMENT_JSON --machine --json
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

2. Read `created`, `unchanged` and `refused`. Each refused id names its
   reason, and the command exits 1. An edited recipe or configuration revision
   is always refused, because revisions are immutable
   ([P1](packages/delivery/docs/model.md#47-recipe)). Add a new revision id
   instead.

3. When `created.carriedSelections` is not zero, read the reconcile on the
   hub's activity page. Each carried environment kept its accepted bytes under
   the catalog's component names and owners
   ([section 7](packages/delivery/docs/model.md#7-fit-to-the-inventory)).

Registration changes nothing that runs
([C3](packages/delivery/docs/model.md#41-catalog)). A new automatic environment
with no promotion source receives the live set on the next dispatch
([E0](packages/delivery/docs/model.md#410-environment)).

## Change a recipe or configuration

A recipe or configuration change is its own deployment, called a rebind. It
keeps the accepted set revision.

1. Merge the catalog change that adds the new recipe or configuration
   revision and binds the environment to it.
2. [Register the catalog change](#register-a-catalog-change). The
   environment's declared binding now names the new revision.
3. Request the rebind. Name only the revision that changes; Delivery refuses a
   revision the catalog does not declare for the environment:

   ```bash
   toolkit deploy rebind ENVIRONMENT --recipe RECIPE_REVISION --configuration CONFIGURATION_REVISION --json
   ```

4. Approve if required, then wait and watch the monitor as in
   [Deploy a set revision](#deploy-a-set-revision).

## Roll back an environment

1. List the rollback candidates:

   ```bash
   toolkit deploy candidates ENVIRONMENT --json
   ```

   Each candidate is a previously accepted deployment, newest first. The
   accepted one is listed too, so it can be re-asserted. Excluded candidates
   state why ([D9](packages/delivery/docs/model.md#412-deployment)). A
   Minecraft rollback restarts the retained volume and does not restore an
   older world. Scheduled Velero backups are the only Minecraft backup.

2. Request the rollback by the candidate's deployment id. It restores that
   deployment's set revision, recipe and configuration together:

   ```bash
   toolkit deploy rollback ENVIRONMENT DEPLOYMENT_ID --json
   ```

   The command refuses an unknown or excluded candidate with the server's
   reason before it sends anything.

3. Approve if required, then wait and watch the monitor as in
   [Deploy a set revision](#deploy-a-set-revision).

:::caution
An excluded candidate cannot be forced. A candidate that would lower a
`forwardOnly` key or cross a `pointOfNoReturn` step needs a roll-forward: a new
set revision or a rebind.
:::

## Respond to an alarmed monitor

1. Read the monitor's alarms and evidence counts:

   ```bash
   toolkit deploy monitor ENVIRONMENT --json
   ```

   Alarms marked pre-existing became active before the deployment's claim.
   They do not count against it
   ([W2](packages/delivery/docs/model.md#419-monitor)).

2. Find the automatic rollback, if the monitor's policy is `automatic`:

   ```bash
   toolkit deploy status --json
   ```

   The environment shows a queued rollback to its last settled or unmonitored
   selection, carrying that selection's approval as a `restoration` approval
   ([H5](packages/delivery/docs/model.md#413-approval)). Wait for it with
   `toolkit deploy wait`. With no permitted candidate, or one that was never
   approved where approval is required, the environment is held with the
   reason instead.

3. Under `hold` policy, or for a held environment,
   [roll back from the candidates](#roll-back-an-environment) or deploy a fixed
   set revision.

The alarmed set revision is skipped by automatic selection until a newer
eligible one exists ([D3](packages/delivery/docs/model.md#412-deployment)). An
explicit `toolkit deploy start` of it is still accepted.

## Recover a deployment that requires recovery

A deployment ends `recovery-required` after an ambiguous effect, an expired
lease, or an unsettled sub-step. It keeps its locks until a recovery intent
succeeds ([4.15](packages/delivery/docs/model.md#415-recovery-intent)).

1. Read the deployment's environment generation, its recipe and the sub-step
   it names:

   ```bash
   toolkit deploy status DEPLOYMENT_ID --json
   ```

   Keep its `environment.generation` as `GENERATION` for step 6. The
   [deployment detail contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/shared/contract.ts)
   defines that field. The service
   [refuses the recovery](https://github.com/shepherdjerred/monorepo/blob/main/packages/toolkit/README.md#delivery)
   once the environment generation changes.

2. Export the frozen artifact and configuration selection for review:

   ```bash
   toolkit deploy recover DEPLOYMENT_ID --expected-generation GENERATION --reason "Inspect the target and settle ownership" --machine
   ```

   The command prints the request ID it used; keep it. Delivery picks the
   intent's kind from the deployment. A deployment has at most one pending
   intent. This works while writes are paused and while the executor is
   unavailable.

3. Settle the intent by its kind:

   | Kind                              | Settlement                                                                                                                         |
   | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
   | `argo`                            | Steps 4 and 5 below                                                                                                                |
   | `worker`, `platform`, `minecraft` | The dispatcher's recovery Workflow, or its operator entrypoint ([Temporal README](packages/temporal/README.md#delivery-execution)) |
   | `content`                         | The foreground content recovery command with dispatch paused ([Temporal README](packages/temporal/README.md#delivery-execution))   |

4. For an `argo` intent, read the finished operation's UUID from the
   Application the deployment synced. The read goes through the Kubernetes API,
   so it works while ArgoCD's API is down:

   ```bash
   kubectl --context admin@torvalds -n argocd get applications.argoproj.io APPLICATION -o json | jq -er '.status.operationState.operation.info[] | select(.name == "ci.sjer.red/operation-id") | .value'
   ```

   If the Application shows a running operation or none for this deployment,
   keep the lock and inspect it. Settlement refuses either.

5. Settle the `argo` intent with that operation. The same request ID names
   the intent from step 2. Delivery's own reader checks the recorded request,
   the ownership annotation, the finished operation and every Job:

   ```bash
   toolkit deploy recover DEPLOYMENT_ID --expected-generation GENERATION --request-id REQUEST_ID --operation-id ARGO_OPERATION_UUID --reason "Inspected the exact finished operation" --machine
   ```

6. Follow the intent until it reports `succeeded` or `failed`:

   ```bash
   toolkit deploy recovery INTENT_ID --json
   ```

7. On `succeeded`, request a new deployment to reach acceptance. Settlement
   releases the locks but keeps the original failed result and the accepted
   selection.
8. On `failed`, read the recorded inspection evidence. Correct the target, then
   create a new intent.

:::danger
Never delete a lock row or replace a foreign ArgoCD operation to release a
deployment. Only an intent settled by the independent reader may release it.
:::

## Run an operator-run deployment

Operator-run environments cover work Delivery cannot execute from inside the
cluster: cluster admission, the Delivery and Temporal data layers,
operator-only OpenTofu stacks, node upgrades and bootstrap
([section 5](packages/delivery/docs/model.md#5-target-kinds)).

1. Request the deployment. `start` sends an `operator-run` deployment for an
   operator-run recipe. Delivery records intent and then waits for evidence on
   each stage:

   ```bash
   toolkit deploy start ENVIRONMENT SET_REVISION --json
   ```

2. List the stages awaiting attestation:

   ```bash
   toolkit deploy status DEPLOYMENT_ID --json
   ```

3. Perform the first stage's procedure by hand. For a node, follow the
   [Talos upgrade](packages/homelab/README.md#upgrade-talos) or
   [Kubernetes upgrade](packages/homelab/README.md#upgrade-kubernetes) steps.
4. Write the evidence as a JSON array of `attestation` entries. Each entry has
   a `summary` and may add a `url` to the log or receipt
   ([evidence contract](packages/delivery/src/shared/evidence-contract.ts)):

   ```json
   [
     {
       "kind": "attestation",
       "summary": "talosctl upgrade completed; node Ready on the target installer"
     }
   ]
   ```

5. Attest the stage. With `--machine`, `attest` uses the attestor credential
   `DELIVERY_ATTEST_TOKEN`, a distinct identity with the `attest` scope that
   the executor never holds
   ([X13](packages/delivery/docs/model.md#9-decisions)):

   ```bash
   toolkit deploy attest DEPLOYMENT_ID --stage STAGE --evidence /private/evidence.json --machine
   ```

   Delivery refuses an attestation from any credential with the `execute`
   scope, or from an identity that claimed or renewed the deployment.

6. Repeat steps 3 to 5 for each remaining stage, then wait for acceptance with
   `toolkit deploy wait`.

## Retire a service

1. Confirm that no deployment of the service is owned or `recovery-required`.
   Retirement refuses otherwise
   ([S3](packages/delivery/docs/model.md#42-service)):

   ```bash
   toolkit deploy status --json
   ```

2. Retire it:

   ```bash
   toolkit deploy retire SERVICE --reason "Replaced by Arcade" --machine
   ```

A retired service keeps each environment's accepted selection and retained
hosts. It admits no further deployment
([S4](packages/delivery/docs/model.md#42-service)).

## If a merge deployed nothing

Check each cause in order with `toolkit deploy versions SERVICE --json` and
`toolkit deploy status --json`.

| Symptom                                         | Cause                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| No new set revision; build `pending` or failed  | Only verified builds compose ([B1](packages/delivery/docs/model.md#44-build))                                                |
| Build stays `pending` after its pipeline passed | It retains an artifact of an earlier pipeline's build that is still pending ([B2](packages/delivery/docs/model.md#44-build)) |
| Build failed naming a retained artifact         | The earlier build it retained from failed; the next pipeline rebuilds ([B2](packages/delivery/docs/model.md#44-build))       |
| No new set revision; build verified             | Every digest matched the base, so nothing changed ([R2](packages/delivery/docs/model.md#46-set-revision))                    |
| New set revision is not the live set            | Its order key is below the live set's ([R4](packages/delivery/docs/model.md#46-set-revision))                                |
| No deployment queued                            | A failed deployment blocks automatic successors ([D2](packages/delivery/docs/model.md#412-deployment))                       |
| No deployment queued after a cancel or alarm    | That set revision is suppressed ([D3](packages/delivery/docs/model.md#412-deployment))                                       |
| No deployment queued after a restore            | The environment is held until its live state is accepted ([section 6](packages/delivery/docs/model.md#6-flows))              |
| Deployment queued but not admitted              | A prerequisite edge is unmet ([Z1](packages/delivery/docs/model.md#418-prerequisite-edge))                                   |
| Nothing queued in prod                          | Prod has a promotion source; promote from it ([M2](packages/delivery/docs/model.md#416-promotion-tree))                      |

## If a static-site deploy gets AccessDenied

The site activator writes each site bucket with the `delivery-static-activator`
SeaweedFS identity. Its allowed buckets are the `siteBuckets` list in the
[storage policy](packages/homelab/src/delivery-storage-policy.json).

1. Confirm the failing bucket is in `siteBuckets`. Add it there in source if it
   is missing.
2. In the SeaweedFS identities config in the `seaweedfs-s3-credentials`
   1Password item, give `delivery-static-activator` the `Read`, `Write`, `List`
   and `Tagging` actions on that bucket. Change no credential or other grant.
3. Wait for the 1Password operator to update the `seaweedfs-s3-credentials`
   Secret in the `seaweedfs` namespace. Then
   [reload the gateway's identities with SIGHUP](https://github.com/seaweedfs/seaweedfs/blob/4.47/weed/s3api/s3api_server.go#L441):

   ```bash
   kubectl exec -n seaweedfs deployment/seaweedfs-s3 -- \
     sh -c 'test "$(cat /proc/1/comm)" = weed && kill -HUP 1'
   ```

4. Probe with the activator's credential using `aws s3api list-objects-v2`. It
   must succeed for the new bucket and return `AccessDenied` for
   `homelab-tofu-state`.
5. Retry the failed deployment:

   ```bash
   toolkit deploy retry DEPLOYMENT_ID --json
   ```

## Bootstrap a configuration-extension graph change

The deployed Woodpecker configuration extension selects the workflows for its
own pull request. Changes under `packages/woodpecker-config-extension` are
[inputs to every workflow](packages/woodpecker-config-extension/src/pipeline/inputs.ts).
If a graph change retires a failing lane, the old extension still selects that
lane for the replacement PR, and the ordinary merge gate cannot pass. The
[`images` lane](packages/woodpecker-config-extension/src/pipeline/lanes/artifacts.ts)
runs only on `main`, so nothing can publish the new extension before merge.
The
[PR-only administrator bypass](packages/homelab/src/tofu/github/rulesets.tf)
is the narrow landing path.

Use this path only when the new graph removes or replaces the blocking
workflow:

1. Get explicit repository-owner authorization for an admin merge exception.
2. Keep the graph change in its Git-Spice PR. Run the extension's focused
   build, typecheck, tests and lint locally.
3. Wait for the exact PR head's automated review, `verify`, and every
   unaffected required check. Confirm from the logs that each failure belongs
   only to a lane the new graph removes or replaces.
4. Have the repository owner merge that PR with the forge's admin
   branch-protection override. Never mark the retired lane successful or edit
   its required-check result.
5. Follow the resulting `main` pipeline through `images`. Then wait for
   Delivery to accept the `woodpecker/prod` deployment of the new
   `image:woodpecker-config-extension` artifact:

   ```bash
   toolkit deploy status --json
   toolkit deploy wait DEPLOYMENT_ID --json
   ```

6. Retry the affected PR and confirm the replacement graph is selected.

Never patch the live Deployment to break this cycle. The exception lands
reviewed source; Delivery's deployment and acceptance still provide the
release evidence.

## Related

- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [Restore the Delivery record](/how-to/restore-the-delivery-record/)
- [Delivery model reference](/reference/delivery-model/)
- [How the Delivery hub follows a change](/explanation/homelab/delivery-hub/)
- [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
