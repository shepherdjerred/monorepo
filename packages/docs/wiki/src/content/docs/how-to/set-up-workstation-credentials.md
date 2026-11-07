---
title: Set up workstation credentials
description: Give a Mac agent host full homelab access with no credential files on disk, so kubectl, talosctl, aws, gcx, and argocd get their secrets from toolkit at call time.
sidebar:
  order: 45
---

This guide prepares a Mac so agents can type `kubectl`, `talosctl`,
`aws --profile …`, `gcx`, and `argocd` as usual while every secret stays in
1Password and the login Keychain. The [toolkit credentials
reference](packages/toolkit/README.md#credentials) lists each credential and
its source.

## Before you start

| Piece                         | Where                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| Homelab service account       | Keychain item enrolled by `swift scripts/onepassword/enroll-service-account.swift`            |
| Developer ID Application cert | Exported from the release Mac as a `.p12`, stored in the private vault                        |
| ArgoCD `workstation` token    | `argocd-workstation-token`, minted by [`token.tf`](packages/homelab/src/tofu/argocd/token.tf) |
| chezmoi `agent-host` profile  | [`MACOS_FRESH_INSTALL.md`](packages/dotfiles/MACOS_FRESH_INSTALL.md)                          |

## Steps

1. Import the Developer ID certificate so `codesign` can use it without a
   prompt. Run this yourself; it asks for the login Keychain password.

   ```bash
   security import developer-id.p12 -k ~/Library/Keychains/login.keychain-db \
     -T /usr/bin/codesign -T /usr/bin/productbuild
   security set-key-partition-list -S apple-tool:,apple:,teamid:<TEAM_ID> -s \
     ~/Library/Keychains/login.keychain-db
   rm developer-id.p12
   ```

2. Store notarization credentials for release lanes:

   ```bash
   xcrun notarytool store-credentials <profile> --team-id <TEAM_ID>
   ```

3. Install toolkit. `install:local` signs it with the Developer ID identity
   and fails if there is not exactly one.

   ```bash
   bun run --cwd packages/toolkit install:local
   codesign -dv ~/.local/bin/toolkit 2>&1 | grep -E 'Identifier|TeamIdentifier'
   ```

4. Apply the agent-host dotfiles. This renders a kubeconfig with only the
   server, CA, and an `exec` user; `~/.aws/config` with `credential_process`
   profiles; and the shims in `~/.local/share/toolkit/shims`.

   ```bash
   chezmoi --source packages/dotfiles diff ~/.kube/config ~/.aws/config
   chezmoi --source packages/dotfiles apply ~/.kube/config ~/.aws/config \
     ~/.local/share/toolkit/shims
   ```

5. Open a new shell and confirm each tool works with nothing on disk:

   ```bash
   kubectl get nodes
   talosctl version --short
   aws --profile seaweedfs s3 ls
   aws --profile b2-velero s3 ls s3://sjerred-velero/
   toolkit prom query 'count(up)'
   argocd app list
   rg -l 'client-key-data|PRIVATE KEY|aws_secret_access_key' ~/.kube ~/.talos ~/.aws
   ```

   The last command prints nothing.

:::caution
The Keychain cache only works for the installed, Developer-ID-signed toolkit.
An ad-hoc build would stall agents on a Keychain access prompt, so builds run
through `bun` or from `dist/` read 1Password directly instead.
:::

After rotating a secret in 1Password, run
`toolkit credentials flush <NAME>` so the next use reads the new value.

## Related

- [Sync agent history across machines](/how-to/sync-agent-history-across-machines/)
- [Rotate provider credentials](/how-to/rotate-provider-credentials/)
