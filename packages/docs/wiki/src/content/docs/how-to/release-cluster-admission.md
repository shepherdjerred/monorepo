---
title: Release cluster admission
description: Run an operator-run deployment of cluster-admission/prod, attest each stage, and prove that admission still works.
---

`cluster-admission/prod` renders the cluster's admission policies and
bindings. A broken policy can refuse every Pod, volume claim or Application
change in the cluster, so its environment is `operator-run`: Delivery records
the deployment, the operator performs each stage from outside the cluster, and
Delivery accepts the deployment only after the operator attests all three
stages in order: `apply-safety`, `sync` and `admission-canary`.

Delivery's own ArgoCD account only reads `cluster-admission`, and people's
ArgoCD logins are read-only after the lock-down. The operator tool's
`operator-run` ArgoCD account applies and syncs it. Its token lives in the
1Password item `delivery-argocd-operator-run-token`, which only operators read.

You need:

- cluster-admin `kubectl` access to the homelab;
- `toolkit`, `argocd`, `jq` and `uuidgen` on your path;
- the 1Password service-account wrapper `scripts/onepassword/with-service-account.sh`,
  run from the repository root.

`toolkit deploy attest --machine` uses the attestor credential
`DELIVERY_ATTEST_TOKEN`, which Delivery's executor never holds. Never print a
token; the commands below pass only 1Password references.

## 1. Start the deployment

Request the set revision. Delivery records an `operator-run` deployment and
prints it; its `id` is the deployment ID.

```bash
toolkit deploy start cluster-admission/prod <SET_REVISION_ID>
```

Read the chart revision the deployment selected, and name the token reference
the next stages use:

```bash
DEPLOYMENT_ID='<DEPLOYMENT_ID>'
CHART_VERSION="$(toolkit deploy status "$DEPLOYMENT_ID" --json \
  | jq -r '.versionSet.components["chart:cluster-admission"].version')"
OPERATOR_RUN_TOKEN='op://v64ocnykdqju4ui6j6pua56xw4/delivery-argocd-operator-run-token/tokens/ARGOCD_TOKEN'
```

`CHART_VERSION` must print as a chart version such as `2.0.0-1012345`; stop if
it is empty.

## 2. Attest `apply-safety`

Run the same managed-resources analysis a Delivery sync runs before it
applies. It fails on an immutable-field change or a destructive change to a
policy or binding:

```bash
ARGOCD_TOKEN="$OPERATOR_RUN_TOKEN" scripts/onepassword/with-service-account.sh \
  op run -- bun packages/homelab/scripts/argocd/argocd.ts assert-apply-safe \
  cluster-admission --revision "$CHART_VERSION"
```

If it passes, record what you ran:

```bash
cat > apply-safety.json <<EOF
[{"kind": "attestation", "summary": "assert-apply-safe cluster-admission --revision $CHART_VERSION found no immutable-field or destructive change"}]
EOF
toolkit deploy attest "$DEPLOYMENT_ID" --stage apply-safety \
  --evidence apply-safety.json --machine
```

## 3. Attest `sync`

Point the Application at the selected revision, then sync it to exactly that
revision and wait until it is Synced and Healthy:

```bash
ARGOCD_AUTH_TOKEN="$OPERATOR_RUN_TOKEN" ARGOCD_SERVER=argocd.tailnet-1a49.ts.net \
  scripts/onepassword/with-service-account.sh op run -- \
  argocd app set cluster-admission --revision "$CHART_VERSION" --grpc-web
REQUEST_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
ARGOCD_TOKEN="$OPERATOR_RUN_TOKEN" scripts/onepassword/with-service-account.sh \
  op run -- bun packages/homelab/scripts/argocd/argocd.ts sync-managed \
  cluster-admission --revision "$CHART_VERSION" --request-id "$REQUEST_ID"
```

`sync-managed` repeats the apply-safety analysis and fails unless the sync
finishes. Then attest it:

```bash
cat > sync.json <<EOF
[{"kind": "attestation", "summary": "sync-managed cluster-admission --revision $CHART_VERSION finished Synced and Healthy (request $REQUEST_ID)"}]
EOF
toolkit deploy attest "$DEPLOYMENT_ID" --stage sync --evidence sync.json --machine
```

## 4. Attest `admission-canary`

The canary proves that admission still works after the change (model T7). It
uses server-side dry runs, so the API server runs every admission policy and
nothing is created.

A Pod is admitted. The command prints
`pod/delivery-admission-canary created (server dry run)`:

```bash
kubectl --namespace default run delivery-admission-canary \
  --image=registry.k8s.io/pause:3.10 --restart=Never --dry-run=server \
  --overrides='{"apiVersion":"v1","spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":65535,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"delivery-admission-canary","image":"registry.k8s.io/pause:3.10","securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}'
```

A classified volume claim is admitted and labelled by the backup policy. A CI
workspace claim is excluded from backup by its class, so the output shows
`"velero.io/backup":"disabled"` and `"velero.io/exclude-from-backup":"true"`:

```bash
kubectl create --dry-run=server -o jsonpath='{.metadata.labels}' -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: delivery-admission-canary
  namespace: woodpecker-ci
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: ci-workspace
  resources:
    requests:
      storage: 1Gi
EOF
```

An unclassified claim is still refused, so the backup policy is in force. The
command fails with
`PVC is absent from the explicit backup policy; classify it before creation or update`:

```bash
kubectl create --dry-run=server -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: delivery-admission-canary
  namespace: default
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
EOF
```

An Application sync-options update is admitted, and the mutating policy merges
the Application's declared sync options into the requested sync. The output
lists `Validate=false` followed by `cluster-platform`'s declared options
(`CreateNamespace=true`, `ServerSideApply=true`,
`RespectIgnoreDifferences=true`):

```bash
kubectl --namespace argocd patch application cluster-platform --type merge \
  --dry-run=server -o jsonpath='{.operation.sync.syncOptions}' \
  -p '{"operation":{"sync":{"syncOptions":["Validate=false"]}}}'
```

If all four behave as described, attest the canary:

```bash
cat > admission-canary.json <<EOF
[{"kind": "attestation", "summary": "Server dry runs after cluster-admission $CHART_VERSION: canary Pod admitted; CI workspace claim admitted with the disabled backup labels; unclassified claim refused by the backup policy; cluster-platform sync options merged by the sync-options policy"}]
EOF
toolkit deploy attest "$DEPLOYMENT_ID" --stage admission-canary \
  --evidence admission-canary.json --machine
toolkit deploy wait "$DEPLOYMENT_ID"
```

`toolkit deploy wait` returns once Delivery accepts the deployment.

## If a stage fails

Do not attest a stage that failed. Cancel the deployment with
`toolkit deploy cancel "$DEPLOYMENT_ID"`. If `sync` already applied, repeat
step 3 with the previously accepted chart revision, which
`toolkit deploy candidates cluster-admission/prod` lists. If a policy now
refuses ArgoCD's own writes, follow
[Regain write access to ArgoCD](/how-to/regain-write-access-to-argocd/): its
step 3 lifts the binding that guards Application sources.

## Related

- [Regain write access to ArgoCD](/how-to/regain-write-access-to-argocd/)
- [Set the ArgoCD operator password](/how-to/set-the-argocd-operator-password/)
