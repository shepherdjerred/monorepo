---
title: Set the ArgoCD operator password
description: Provision or rotate the read-only operator login before ArgoCD's admin account is disabled.
---

Store the `operator` password in 1Password and write its bcrypt hash into
`argocd-secret` before human ArgoCD access becomes read-only.

`humanArgoCdReadOnly()` in
`packages/homelab/src/cdk8s/src/resources/argo-applications/platform/argocd-human-access.ts`
declares the `operator` account and disables `admin` in the same change.
ArgoCD reads a local account's password only from `argocd-secret`, so the hash
must already be there when that change deploys. Otherwise nobody can sign in.
You need cluster-admin `kubectl` access to the homelab.

## 1. Store the password

Create a Login item named `ArgoCD operator` in the homelab vault. Let 1Password
generate a password of at most 72 characters; ArgoCD's bcrypt rejects longer
ones. Note the item ID for the commands below.

## 2. Write the hash into `argocd-secret`

```bash
scripts/onepassword/with-service-account.sh sh -c '
  hash="$(op read -n "op://v64ocnykdqju4ui6j6pua56xw4/<item-id>/password" |
    htpasswd -niBC 10 "" | tr -d ":\n" | sed "s/\$2y/\$2a/")"
  unset OP_SERVICE_ACCOUNT_TOKEN
  kubectl -n argocd patch secret argocd-secret --type merge -p "{\"stringData\":{
    \"accounts.operator.password\":\"$hash\",
    \"accounts.operator.passwordMtime\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}"
'
```

The password goes from `op` to `htpasswd` on a pipe. It never reaches the
terminal, the process list, or shell history. The `argocd` Application leaves
these keys alone because its chart does not render them.

## 3. Confirm the stored hash

```bash
scripts/onepassword/with-service-account.sh sh -c '
  HASH="$(kubectl -n argocd get secret argocd-secret \
    -o jsonpath="{.data.accounts\.operator\.password}" | base64 -d)"
  op read -n "op://v64ocnykdqju4ui6j6pua56xw4/<item-id>/password" |
    HASH="$HASH" bun -e "console.log(await Bun.password.verify(await Bun.stdin.text(), process.env.HASH))"
'
```

It prints `true`. Do not turn `humanArgoCdReadOnly()` on until it does.

## 4. Verify access after the lock-down deploys

Sign in with the password from 1Password when prompted:

```bash
argocd login argocd.sjer.red --username operator --grpc-web
argocd account can-i get applications '*'
argocd account can-i sync applications '*'
```

The checks print `yes` and then `no`. Signing in as `admin` is refused. If the
`operator` login fails, follow
[Regain write access to ArgoCD](/how-to/regain-write-access-to-argocd/) to
re-enable `admin`, then repeat steps 2 and 3.

:::note
To rotate the password, repeat steps 1 to 3 with a new password. The new
`passwordMtime` ends every `operator` session signed in before it.
:::

## Related

- [Regain write access to ArgoCD](/how-to/regain-write-access-to-argocd/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
