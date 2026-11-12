# cdk8s

[cdk8s](https://cdk8s.io/) app that generates every Kubernetes manifest for the homelab. `bun run build` runs `src/app.ts` and `scripts/patch.ts` to synthesize the YAML into `dist/`; ArgoCD deploys the result via the pushed Helm chart (never `kubectl apply`).

## Layout

- `src/app.ts` — entry point; charts are registered in `src/setup-charts.ts`
- `src/cdk8s-charts/` — one chart per service/namespace (`create{Name}Chart`)
- `src/resources/argo-applications/` — the ArgoCD `Application` per chart, wired up in `src/cdk8s-charts/apps.ts` (app-of-apps)
- `helm/<name>/` — the Helm chart shell (`Chart.yaml`) each app is packaged into
- `src/versions.ts` — every Docker image (pinned SHAs) and Helm chart version, annotated for Renovate; the single source of truth for upgrades
- `generated/helm/` — **committed** TypeScript types for Helm chart values
- `imports/` — generated Kubernetes/CRD types (`bun run update-imports`)
- `src/dockerhub-pull-secrets.ts` — discovers first-party private image consumers
  from the registry catalog and prepares a reader-only `OnePasswordItem` in each
  namespace, including external Helm applications and admission image allowlists.
  The CI credential boundary declares its typed reader secret explicitly so
  step grants can also be checked against the vault snapshot. CI and sandbox
  tokenless service accounts reference the reader secret; publishing uses its
  separate 1Password item.
  Private Docker Hub Pod templates receive their namespace's reader secret at
  synthesis. External Helm applications declare their chart-specific pull-secret
  values, verified against rendered templates.

## Static-site SPA routes

`src/misc/s3-static-site.ts` generates Caddy routes for S3-backed sites. A
configured SPA prefix rewrites extensionless document paths to its index object
before the S3 lookup, so deep links return HTTP 200. Paths ending in a file
extension keep their original lookup and return HTTP 404 when the asset is
missing. The S3 error page remains available for that 404 response.

## Catalog recipes and companion charts

The Delivery catalog (`packages/ops-model/catalog-document.json`) names each
environment's recipe and configuration revision; the revisions themselves live
in `packages/delivery/registrations/v2/<service>/<environment>/`. They are
serialised from the Application constructors in `src/catalog/`, rendered with
transition rendering on, which is the state the cutover's final root release
applies: the whole Application body, the image parameters a chart's templates
or an upstream chart's values pin, and the upstream values as configuration.
`src/catalog/catalog-targets.ts` holds what the constructors cannot say: the
Application per environment, operator-run stages, the `platform` lock, Scout's
monitors and the Minecraft sandbox's test suites.

```bash
bun run generate:catalog   # rewrite every revision file from the constructors
```

`catalog-inventory.test.ts` fails when a committed file and its constructor
disagree, and when the catalog's prerequisite edges differ from the ones the
rendered charts imply (`src/catalog/catalog-edges.ts`). A regenerated file
that changed needs a new revision id in the catalog: Delivery refuses to
change a registered revision.

Fourteen upstream-chart constructors also render Ingresses, TunnelBindings,
OnePasswordItems, claims and Velero Schedules into the root chart. Under
transition rendering each gets a `<application>-companion` chart
(`src/resources/companions/`) that renders the same objects with the root's
names and waves, so its Application adopts them unchanged once the root is
orphaned; `companions.test.ts` proves the bytes match.

## Helm value types

The committed types in `generated/helm/` are the source of truth — CI does not regenerate them. When changing a chart in `../../../version-catalog/src/catalog.json`, regenerate and commit:

```bash
bun run generate-helm-types
```

The Woodpecker Helm types drift check fails any PR that changes a generator input without regenerating.

The generator also writes `generated/helm/chart-values-map.ts`, the map from
chart name to values type that `HelmValuesForChart<"chart">` indexes, so a
chart added to the catalog needs no hand-written registration.

## Argo Applications

Every `Application` is built by a factory in `src/misc/argo/application.ts`,
which supplies what is the same everywhere: the in-cluster destination server,
the AppProject looked up from the Application's name, a revision history limit
of 5 and a construct id of `<name>-app`.

- `helmApplication` installs an upstream chart. Its `chart` selects the type
  `valuesObject` is checked as, so values written for another chart do not
  compile. `uncheckedValuesObject` carries values the generated type cannot
  express; spread the typed values into it so only the extra key escapes.
- `createFirstPartyApplication` installs a wrapper chart from ChartMuseum at
  the floating first-party revision.
- `argoApplication` is the base both use, for a source that is not a Helm
  chart, and takes a `spec` escape hatch merged over the derived fields.

`syncPolicy` is required and has no default. The fleet's policies differ
(`automated: {}` against `{ enabled: true }`, `prune`, `selfHeal`, a missing
`CreateNamespace`) and an Application body is a Delivery recipe revision, so
each call site states the policy it renders; `undefined` renders none.

## Home Assistant pet-care alerts

`config/homeassistant/configuration.yaml` owns the qualified pet-care problem
sensors. Temporal owns the holds, incident state, and notification delivery:
five minutes for litter-robot, feeder, and fountain-operation problems, 45
minutes for a continuous Litter-Robot waiting or cycling sequence, and 15
minutes below 650 mL for a fountain shortage. Feeder problems also include
more than 14 hours without dispensing; the food-status signal combines low
and empty food. The water check reads the volume sensor's `mL` attribute, not
its fluid-ounce state or percentage sensor.

After a hold, Temporal creates a persistent HA notification, pushes to
`notify.mobile_app_jerreds_iphone`, and publishes the warning to Alertmanager.
Confirmed recovery dismisses the HA notification and resolves the same
Alertmanager alert. Unknown or unavailable sensor state cancels a pending hold
without dismissing an active incident. HA startup and WebSocket reconnects
reconcile the current sensor states. Prometheus continues to alert on missing
pet-care telemetry; battery, desiccant, filter, and cleaning maintenance rules
remain separate.

## 1Password lint

`check:1password` verifies offline that every `OnePasswordItem` reference (item and field) exists in the vault, using a committed hash-only snapshot (`onepassword-vault-snapshot.json`):

```bash
bun run check:1password                       # offline lint (runs in bun run verify)
bun run scripts/snapshot-1password-vault.ts   # refresh snapshot after vault changes (needs op)
```

## First-party web services

`FirstPartyWebService` (`src/misc/first-party/web-service.ts`) renders a
first-party HTTP service from one description: a single-replica Deployment
with a writable `/tmp`, its `http` Service and ServiceMonitor, kubelet probes,
an optional NVMe data claim, the Tailscale hosts or Cloudflare hostname it is
reached on, and the namespace's NetworkPolicies. A service with neither kind
of host is internal-only. Names derive from the `name` and the ids it is
given, so moving an existing service onto it renames nothing, and
`.deployment`, `.service`, `.serviceMonitor`, `.policies` and `.dataVolume`
remain reachable for anything it does not model. A service may also state
sidecar containers, a separate `metrics` port for Prometheus, its own pod
metadata, and `tmp: false` when its root filesystem is writable.
`trmnl-dashboard`, `tracker`, `alert-dashboard`, `tasknotes`, `media-api` and
`storm-brain` use it. `glitter-boys-launcher` does not: its Deployment,
Services and NetworkPolicy carry chart-derived names the construct does not
produce, and it scrapes a second, separately labelled metrics Service.

## First-party workers

`FirstPartyWorker` (`src/misc/first-party/worker.ts`) is the same idea for a
workload nothing routes to, a bot or a background worker: one Deployment
replaced with `Recreate`, an optional NVMe data claim mounted into its main
container, an optional Service and ServiceMonitor for Prometheus, and the
namespace's NetworkPolicies. Containers state their own names, ports, probes
and mounts, because workers differ in all of them. The `containers` callback
receives the Deployment and runs before the data claim, so 1Password items,
extra claims and Services created inside it keep their place in the rendered
chart; `.deployment`, `.container`, `.service`, `.serviceMonitor`, `.policies`
and `.dataVolume` remain reachable for JSON patches and anything else it does
not model. `birmel`, both `starlight-karma-bot` stages, `streambot` and
`arcade` use it. The two constructs share their container and NetworkPolicy
types through `src/misc/first-party/workload-parts.ts`.

## LinuxServer apps

`LinuxServerApp` (`src/misc/third-party/linuxserver-app.ts`) renders a
LinuxServer.io image from one description: a single-replica Deployment that is
recreated on rollout, the NVMe claims it owns, mounts of claims owned
elsewhere, its Service, and an optional tailnet host and namespace
NetworkPolicies. Names derive from the `name` and the claim ids it is given,
so moving a service onto it renames nothing. What differs between the apps
today is a parameter, not a default: `fsGroup`, `resources`, `probes`, pod
metadata and the proxy class are stated per app, and `extend` carries anything
beyond the common shape (Bazarr's init container, provider mounts and
environment). `.deployment`, `.service`, `.claims` and `.policies` remain
reachable. Sonarr, Radarr, Prowlarr, Tautulli, Bazarr, Syncthing and
Maintainerr use it.

## Rendering from the platform model

[`../platform-model.json`](../platform-model.json) declares the hostnames,
static sites, tailnet services and buckets that OpenTofu also renders. cdk8s
states none of them a second time: it looks each one up, and a lookup for an
id the model does not declare throws during synthesis.

| To render                         | Write                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A hostname through the tunnel     | `createCloudflareTunnelBinding(chart, id, { serviceName, port })`; the hostname is the one routed to the Service |
| One of a Service's several names  | the same, with `hostname: publicHostname("bluemap.ts-mc.net")`                                                   |
| A tailnet ingress                 | `host: tailnetService("plex")` on `TailscaleIngress`, `LinuxServerApp` and `FirstPartyWebService`                |
| A tailnet name in a URL or header | `tailnetService("plex").fqdn` or `.origin`                                                                       |
| A static site                     | an entry under `staticSites` in the model; `resources/s3-static-sites/sites.ts` adds probes, proxies and headers |
| A bucket name in a workload's env | `...seaweedfsS3.bucketEnv("S3_BUCKET", "tracker")`                                                               |
| The in-cluster S3 endpoint        | `seaweedfsS3.endpoint`                                                                                           |

The constructs check the entry they are given: a tunnel binding refuses a
route to another Service or namespace, and an ingress refuses a tailnet
service of another namespace or exposure.

Two call sites build a `TailnetService` by hand because nothing renders their
name yet, so the model cannot declare it: storm-forum's beta stage, and a
service the scaffolder has prepared but not activated.

## Rendered-output safety nets

A refactor of shared constructs must not change what is rendered. Two checks
prove that:

- `bun run check:dist-equivalence` builds `dist/` at `origin/main` (in a
  throwaway worktree) and at the current checkout and diffs the trees. It exits
  non-zero on any difference. A deliberate behavior change names the files it
  means to change, and every other file must still be identical:
  `bun run check:dist-equivalence -- --allow syncthing.k8s.yaml`. Use
  `--base <ref>` to compare against something other than `origin/main`.
- `src/testing/first-party-snapshots.test.ts` keeps committed YAML snapshots
  (`src/testing/fixtures/first-party-snapshots/`) of one representative service per
  shape and its Argo Application, so a shared-construct change shows its blast
  radius as a reviewable diff. Version-catalog pins are replaced by their
  catalog key so upstream bumps do not churn them. Regenerate with
  `bun run test -- src/testing/first-party-snapshots.test.ts --update`.

## Fleet policy tests

`src/fleet-policy/` asserts rules over every synthesized workload instead of
one service at a time:

- every workload is selected by an Ingress and an Egress `NetworkPolicy`, and
  every namespace an upstream chart deploys into has both;
- every container that declares a port, and every workload behind a `Service`,
  has a readiness or startup probe;
- every container sets `allowPrivilegeEscalation: false` and runs under a
  seccomp profile;
- 1Password item paths are built with `vaultItemPath`;
- an Argo Application's Helm values are typed as the chart it installs.

`debt-allowlists.ts` lists today's exceptions to each rule. The tests fail on a
violation that is not listed and on a listed entry that no longer violates, so
the lists only shrink: fix the workload and delete its entry. Do not add an
entry to make a new workload pass.

## Commands

```bash
bun run build       # synthesize manifests into dist/
bun run test            # full suite (plus test:gpu-resources)
bun run diff        # build + helm-render diff against the cluster
bun run render      # build + render only
bun run up          # build + apply via helm-render (operator escape hatch)
bun run typecheck
bun run lint
```

Load the repository `homelab-development` skill for the add-a-service workflow.
See the [homelab overview](../../../docs/wiki/src/content/docs/explanation/homelab/overview.md)
for topology and [../../AGENTS.md](../../AGENTS.md) for always-on constraints.
