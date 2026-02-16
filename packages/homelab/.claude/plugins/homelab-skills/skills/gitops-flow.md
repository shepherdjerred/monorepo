---
description: >-
  Use when asking about deployment pipeline, CI/CD flow, Dagger pipeline,
  ArgoCD sync, or how changes get deployed.
---

# GitOps Deployment Flow

## Overview

Changes flow through: **GitHub → Dagger → Helm → ChartMuseum → ArgoCD → Cluster**

```text
Code Change
    ↓
GitHub Actions (trigger)
    ↓
Dagger Pipeline (build/test)
    ↓
CDK8s Build (generate manifests)
    ↓
Helm Package (create 24 charts)
    ↓
ChartMuseum (store charts)
    ↓
ArgoCD Sync (deploy via app-of-apps)
    ↓
Kubernetes Cluster
```

## Pipeline Triggers

| Event          | Pipeline Mode | Actions                      |
| -------------- | ------------- | ---------------------------- |
| Push to `main` | Production    | Build, test, publish, deploy |
| Pull Request   | Development   | Build, test only             |

## Dagger Pipeline

The pipeline is defined in `.dagger/src/index.ts`:

### Main CI Function

```typescript
@func()
async ci(
  source: Directory,
  argocdToken: Secret,
  ghcrUsername: string,
  ghcrPassword: Secret,
  chartVersion: string,
  chartRepo: string,
  chartMuseumUsername: string,
  chartMuseumPassword: Secret,
  env: Stage = Stage.Dev,
): Promise<string>
```

### Pipeline Steps

#### 1. Version Updates (Prod Only)

```typescript
if (env === Stage.Prod) {
  updatedSource = this.updateHaVersion(source, chartVersion);
  updatedSource = this.updateDependencySummaryVersion(updatedSource, chartVersion);
  updatedSource = this.updateClaudeCodeUIVersion(updatedSource, chartVersion);
}
```

#### 2. Parallel Container Preparation

```typescript
const haContainerPromise = prepareHaContainer(updatedSource);
const cdk8sContainer = prepareCdk8sContainer(updatedSource);
```

#### 3. Parallel Tests/Lints/Builds

```typescript
const [
  renovateTestResult,
  helmTestResult,
  cdk8sTestResult,
  cdk8sLintResult,
  haLintResult,
  cdk8sTypeCheckResult,
  haTypeCheckResult,
  cdk8sBuildResult,
  haBuildResult,
  helmBuildResult,
] = await Promise.all([
  this.testRenovateRegex(updatedSource),
  this.testHelm(updatedSource),
  testCdk8sWithContainer(cdk8sContainer),
  lintCdk8sWithContainer(cdk8sContainer),
  haContainerPromise.then(c => lintHaWithContainer(c)),
  typeCheckCdk8sWithContainer(cdk8sContainer),
  haContainerPromise.then(c => typeCheckHaWithContainer(c)),
  buildK8sManifestsWithContainer(cdk8sContainer),
  buildHa(updatedSource),
  this.helmBuild(...),
]);
```

#### 4. Image Publishing (Prod Only)

```typescript
if (env === Stage.Prod) {
  await Promise.all([
    this.internalPublishHaImage(updatedSource,
      `ghcr.io/shepherdjerred/homelab:${chartVersion}`, ...),
    this.internalPublishHaImage(updatedSource,
      `ghcr.io/shepherdjerred/homelab:latest`, ...),
  ]);
}
```

#### 5. Helm Chart Publishing (Prod Only)

All 24 charts are published to ChartMuseum:

```typescript
if (env === Stage.Prod && helmBuildResult.dist) {
  await this.helmPublishBuilt(
    helmBuildResult.dist,
    `1.0.0-${chartVersion}`,
    chartRepo,
    chartMuseumUsername,
    chartMuseumPassword,
    env,
  );
}
```

#### 6. ArgoCD Sync (Prod Only)

```typescript
if (env === Stage.Prod && helmPublishResult.status === "passed") {
  await argocdSync(argocdToken); // Syncs "apps" application
}
```

## CDK8s Build Process

### Build Command

```bash
bun run build  # In src/cdk8s
```

### Output

CDK8s synthesizes Kubernetes YAML manifests to `src/cdk8s/dist/`:

```text
src/cdk8s/dist/
├── apps.k8s.yaml       # ArgoCD applications (app-of-apps)
├── media.k8s.yaml      # Media namespace resources
├── home.k8s.yaml       # Home namespace resources
├── postal.k8s.yaml     # Postal namespace resources
├── syncthing.k8s.yaml  # Syncthing namespace resources
├── freshrss.k8s.yaml   # FreshRSS namespace resources
├── golink.k8s.yaml     # GoLink namespace resources
├── pokemon.k8s.yaml    # Pokemon namespace resources
├── gickup.k8s.yaml     # Gickup namespace resources
└── ...                 # Other charts
```

## Helm Chart Packaging

From `.dagger/src/helm.ts`:

```typescript
export const HELM_CHARTS = [
  "ddns",
  "apps",
  "scout-beta",
  "scout-prod",
  "starlight-karma-bot-beta",
  "starlight-karma-bot-prod",
  "redlib",
  "sjer-red",
  "webring",
  "dpp-docs",
  "better-skill-capped",
  "plausible",
  "birmel",
  "scout-frontend",
  "cloudflare-tunnel",
  // Per-service namespace charts
  "media",
  "home",
  "postal",
  "syncthing",
  "golink",
  "freshrss",
  "pokemon",
  "gickup",
  "grafana-db",
] as const;
```

### Chart Version Format

```text
{chartname}-1.0.0-{github_run_number}.tgz
```

## ChartMuseum

### Chart Repository

```text
https://chartmuseum.tailnet-1a49.ts.net
```

### Publishing

```typescript
export async function publishAllCharts(
  allChartsDist: Directory,
  version: string,
  repo: string,
  chartMuseumUsername: string,
  chartMuseumPassword: Secret,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  for (const chartName of HELM_CHARTS) {
    const chartDist = allChartsDist.directory(chartName);
    results[chartName] = await publishChart(chartName, chartDist, version, ...);
  }

  return results;
}
```

## ArgoCD Sync

From `.dagger/src/argocd.ts`:

```typescript
export async function sync(
  argocdToken: Secret,
  argocdServer = "https://argocd.tailnet-1a49.ts.net",
  appName = "apps", // App-of-apps that manages all other apps
): Promise<StepResult> {
  // POST to ArgoCD sync API
  await container.withExec([
    "sh",
    "-c",
    `curl -X POST ${argocdServer}/api/v1/applications/${appName}/sync ` + '-H "Authorization: Bearer $ARGOCD_TOKEN"',
  ]);
}
```

## GitHub Actions Workflow

From `.github/workflows/ci.yml`:

```yaml
jobs:
  build:
    runs-on: homelab-runner-set
    steps:
      - uses: actions/checkout@v4

      - name: Run Dagger Pipeline
        run: |
          dagger call ci \
            --source . \
            --argocd-token env:ARGOCD_TOKEN \
            --ghcr-username ${{ github.actor }} \
            --ghcr-password env:GHCR_TOKEN \
            --chart-version ${{ github.run_number }} \
            --env ${{ github.ref == 'refs/heads/main' && 'prod' || 'dev' }}
```

## Manual Operations

### Run Local Build

```bash
cd src/cdk8s
bun run build
```

### Run Dagger Pipeline Locally

```bash
dagger call ci \
  --source . \
  --argocd-token env:ARGOCD_TOKEN \
  --ghcr-username myuser \
  --ghcr-password env:GHCR_TOKEN \
  --chart-version local-test \
  --env dev
```

### Force ArgoCD Sync

```bash
argocd app sync apps
# Or via API
curl -X POST https://argocd.tailnet-1a49.ts.net/api/v1/applications/apps/sync \
  -H "Authorization: Bearer $ARGOCD_TOKEN"
```

### Check ArgoCD Status

```bash
argocd app get apps
argocd app list
argocd app get media  # Check specific namespace app
```

## Rollback

### Via ArgoCD UI

1. Go to https://argocd.tailnet-1a49.ts.net
2. Select the application to rollback (e.g., `media`, `home`)
3. Click "History and Rollback"
4. Select previous revision

### Via CLI

```bash
argocd app rollback media <revision>
```

## Key Files

- `.github/workflows/ci.yml` - GitHub Actions workflow
- `.dagger/src/index.ts` - Main Dagger pipeline
- `.dagger/src/cdk8s.ts` - CDK8s build functions
- `.dagger/src/helm.ts` - Helm packaging and publishing (HELM_CHARTS list)
- `.dagger/src/argocd.ts` - ArgoCD sync function
- `src/cdk8s/helm/{chartname}/Chart.yaml` - Helm chart definitions
- `src/cdk8s/src/main.ts` - CDK8s entry point
