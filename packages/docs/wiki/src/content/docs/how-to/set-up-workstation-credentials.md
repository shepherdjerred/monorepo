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

| Piece                        | Where                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Homelab service account      | Keychain item enrolled by `swift scripts/onepassword/enroll-service-account.swift`                      |
| Apple Developer account      | Signed in under Xcode → Settings → Apple Accounts; current Program License Agreement accepted           |
| ArgoCD `workstation` token   | `argocd-workstation-token`, minted by the [`argocd` stack](packages/homelab-cdktn/src/stacks/argocd.ts) |
| chezmoi `agent-host` profile | [`MACOS_FRESH_INSTALL.md`](packages/dotfiles/MACOS_FRESH_INSTALL.md)                                    |

## Steps

1. In Xcode, open **Settings → Apple Accounts**, select the team, choose
   **Manage Certificates…**, and add a **Developer ID Application**
   certificate. Its private key stays in this Mac's login Keychain. Confirm
   exactly one appears:

   ```bash
   security find-identity -v -p codesigning
   ```

2. Let `codesign` use the key without a prompt. It asks for the login
   password.

   ```bash
   security set-key-partition-list -S apple-tool:,apple:,teamid:<TEAM_ID> -s \
     ~/Library/Keychains/login.keychain-db
   ```

3. Store a notarytool profile for release lanes that use one, with an
   app-specific password from appleid.apple.com. Xcode-based lanes such as
   Brim notarize through the signed-in account instead.

   ```bash
   xcrun notarytool store-credentials notary --apple-id <apple-id> \
     --team-id <TEAM_ID>
   ```

4. Install toolkit. `install:local` signs it with the Developer ID identity
   and fails if there is not exactly one.

   ```bash
   bun run --cwd packages/toolkit install:local
   codesign -dv ~/.local/bin/toolkit 2>&1 | grep -E 'Identifier|TeamIdentifier'
   ```

5. Apply the agent-host dotfiles. This renders a kubeconfig with only the
   server, CA, and an `exec` user; `~/.aws/config` with `credential_process`
   profiles; and the shims in `~/.local/share/toolkit/shims`.

   ```bash
   chezmoi --source packages/dotfiles diff ~/.kube/config ~/.aws/config
   chezmoi --source packages/dotfiles apply ~/.kube/config ~/.aws/config \
     ~/.local/share/toolkit/shims
   ```

6. Open a new shell and confirm each tool works with nothing on disk:

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
