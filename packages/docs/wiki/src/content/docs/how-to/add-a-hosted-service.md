---
title: Add a hosted service
description: Scaffold a first-party web service or worker in its prepared state, then activate it so Delivery deploys it.
---

A hosted service lands in two changes: one that prepares it and deploys
nothing, and one that activates it.
[Why a hosted service is a construct, a policy test and a checklist](/explanation/homelab/hosted-service-model/)
explains the split.

## Prepare the service

1. Scaffold it from the repository root:

   ```bash
   bun scripts/misc/new-service.ts --name notes --kind web --port 7400 --host notes
   ```

   | Flag      | Value                                                               |
   | --------- | ------------------------------------------------------------------- |
   | `--name`  | Kebab-case. Names the package, image, chart, namespace, Application |
   | `--kind`  | `web` for an HTTP service, `worker` for a workload with no ingress  |
   | `--port`  | The listening port, or a worker's health port. 1024 to 55535        |
   | `--host`  | The tailnet hostname. Required for `web`, refused for `worker`      |
   | `--title` | The catalog title. Defaults to the name in sentence case            |

   The command writes the package, the chart, the Argo Application and every
   registration. It then installs, runs `generate:catalog` and runs the
   completeness check. It prints each file it wrote.

2. Bump the three inventory counts that a new image and chart change. Run the
   suite and edit the literal each failure names:

   ```bash
   bunx turbo run test --filter=@shepherdjerred/root-scripts
   ```

   | Test                                                          | Counts             |
   | ------------------------------------------------------------- | ------------------ |
   | `ci/scripts/images/live-version-catalog.test.ts`              | Canonical images   |
   | `ci/scripts/images/application-image-reproducibility.test.ts` | Application images |
   | `scripts/ci/publish-delivery.test.ts`                         | Published charts   |

3. Add the package to the inventory table in
   [`packages/README.md`](https://github.com/shepherdjerred/monorepo/blob/main/packages/README.md)
   and write its own `README.md`.

4. Build the service. Keep `/healthz` answering, or change the probe paths in
   `packages/homelab/src/cdk8s/src/resources/<name>/index.ts` and the smoke
   command in
   [`smoke-app-in-image.ts`](https://github.com/shepherdjerred/monorepo/blob/main/ci/scripts/images/smoke-app-in-image.ts)
   together. Add each workspace dependency to both `COPY` lists in the
   Dockerfile, and each network dependency as an egress rule in the chart.

5. Verify, then open the pull request:

   ```bash
   bunx turbo run build typecheck test lint \
     --filter=@shepherdjerred/notes --filter=@homelab/cdk8s \
     --filter=@shepherdjerred/root-scripts --filter=@shepherdjerred/ops-model
   bun run check-service-registration
   docker build --target smoke -f packages/notes/Dockerfile .
   ```

6. Merge. The main pipeline builds and publishes the image, and publishes the
   chart with its inactive marker. No Application renders.

:::note
`bun run check-service-registration` prints a checklist of whatever a
registration lacks. Use it to finish a service that was added by hand.
:::

## Activate the service

Activate only after the image has a published build. Replace `notes` with the
service's name throughout.

1. Add the secrets the workload reads. Follow the secrets rules in
   [`packages/homelab/AGENTS.md`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/AGENTS.md).

2. Set the gate `NOTES_ACTIVE` to `true` in
   `packages/homelab/src/cdk8s/src/resources/notes/index.ts`.

3. Edit the service's entry in
   [`catalog-document.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/ops-model/catalog-document.json):

   | Where                        | Change                                                                               |
   | ---------------------------- | ------------------------------------------------------------------------------------ |
   | `services[].ops`             | Add `"argoApps": ["notes"]`                                                          |
   | `services[].legacy`          | Replace its contents with one `deploy` variant, as the `tracker` service has         |
   | `environments`               | Add `notes/prod`, copied from `tracker/prod`: recipe revision `2`, configuration `1` |
   | `legacy.deliveryDelegations` | Add `"notes": "notes/prod"`                                                          |

   Make the same change to the `notes` entry and `deliveryDelegations` in
   [`services.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/ops-model/services.json).

4. Add `notes: "notes/prod"` to `ORDINARY_DELIVERY_ENVIRONMENTS` in
   [`delivery-target-policy.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/delivery-target-policy.ts).
   Copy
   [`registrations/ordinary/tracker`](https://github.com/shepherdjerred/monorepo/tree/main/packages/delivery/registrations/ordinary/tracker)
   to `registrations/ordinary/notes` and rename every `tracker` in both files.

5. For a web service, declare its tailnet host in
   [`platform-model.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/platform-model.json),
   beside the `tracker` host, and replace the prepared `host` entry in
   `resources/notes/index.ts` with `tailnetService("notes")`, imported from
   `homelab/src/platform-model.ts`. The lookup fails synthesis for a host the
   model does not declare.

6. Delete the service's line from `chartsWithoutRecipe` in
   `scripts/checks/service-registration-exemptions.json`.

7. Generate the recipe and configuration:

   ```bash
   bun run --cwd packages/homelab/src/cdk8s generate:catalog
   ```

   The first run fails and prints the prerequisite edges the Application
   implies. Add them to `edges` in `catalog-document.json` and run it again.
   Give every other file it rewrote under `registrations/v2` a new revision id
   in the catalog.

8. Run the suites and bump each inventory a failure names:

   ```bash
   bunx turbo run test --filter=@homelab/cdk8s --filter=homelab \
     --filter=@shepherdjerred/ops-model --filter=@shepherdjerred/toolkit \
     --filter=@shepherdjerred/root-scripts
   bun run check-service-registration
   ```

9. Merge, then
   [register the catalog change](/how-to/cut-a-homelab-release/#register-a-catalog-change).
   Delivery deploys the new automatic environment on its next dispatch.

10. Verify the Application is healthy and the service answers on its host.

:::caution
Do not flip the gate without the catalog change. Synthesis refuses an
Application that the catalog does not name.
:::

## Related

- [Why a hosted service is a construct, a policy test and a checklist](/explanation/homelab/hosted-service-model/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Delivery model reference](/reference/delivery-model/)
