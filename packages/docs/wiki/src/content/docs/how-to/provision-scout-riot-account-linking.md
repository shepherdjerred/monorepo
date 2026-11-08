---
title: Provision Scout Riot account linking
description: Configure Riot Sign On credentials and callbacks, release the bootstrap, and verify personal notification controls.
---

Provision the existing Riot Sign On client before enabling new account links.

1. Open Scout's Riot Developer Portal client. Confirm **Client Secret Basic**
   and League access. Use its OAuth client ID, not the linked application ID.
   Retrieve the existing secret through 1Password. A secret hash is not the
   secret; rotate only with separate authorization if the original is lost.
2. Register exact redirect URIs for the environments being enabled:

   | Environment       | Redirect URI                                            |
   | ----------------- | ------------------------------------------------------- |
   | Beta              | `https://beta.scout-for-lol.com/api/auth/riot/callback` |
   | Production        | `https://scout-for-lol.com/api/auth/riot/callback`      |
   | Default local dev | `http://localhost:5180/api/auth/riot/callback`          |

   Register local HTTP only if Riot permits it for this client. Otherwise use
   an approved HTTPS development origin and register its exact callback.
   Set the client's privacy and terms URLs to Scout's published pages.
   Scout does not use Riot logout redirects or request offline access.

3. Add semantic fields `RIOT_RSO_CLIENT_ID` and `RIOT_RSO_CLIENT_SECRET` to
   each enabled stage's existing Scout 1Password item. Use the existing
   service-account wrapper; never write credential values to repository files.
   Refresh the homelab vault metadata snapshot with
   `packages/homelab/src/cdk8s/scripts/snapshot-1password-vault.ts`.
4. Set that stage's `SCOUT_RSO_PROVISIONED` entry in
   `packages/homelab/src/cdk8s/src/resources/scout/riot-rso.ts` to `true`.
   Run `bun run --filter=@homelab/cdk8s check:1password`. The bootstrap uses
   required secret references only in the application pod. Release through
   the normal homelab GitOps path and verify the new revision and runtime.
5. Use the typed `riot_account_linking_enabled` rollout for new links. The
   managed inventory targets beta; production defaults off. Disabling this
   flag preserves existing account toggles and notification enforcement.
6. Sign in with Discord and open **Account → Privacy settings**. Link an account,
   finish Riot sign-in, and confirm that the correct Riot ID appears with
   notifications enabled. Link another account to confirm independent controls.
   Verify that a second Discord identity cannot claim the first account.
7. Disable one account's notifications. Confirm that new and queued automatic
   prematch/postmatch notifications no longer send solely for that account.
   Confirm a shared report still sends through another eligible account with
   normal names and mentions. Re-enable and verify a future game; missed games
   must not be replayed.

For local RSO verification, resolve both credential fields with `op run` from
`dev-riot-rso.env.tpl` alongside `dev-web.env.tpl`, then run
`bun src/dev-web.ts` with `OP_SERVICE_ACCOUNT_TOKEN` removed. Supply a complete
`FEATURE_FLAGS_STATIC_OVERRIDES` JSON object based on
`DEFAULT_STATIC_FLAG_OVERRIDES`, changing `riot_account_linking_enabled` to
`true`. The default local harness keeps new linking disabled and needs no RSO
credentials. Its Discord session signing key must remain local-only.

If verification reports a project mismatch, confirm the RSO client is linked
to the application that owns Scout's Riot API key. Do not remove the PUUID
comparison or transfer an existing owner to bypass a conflict. Resolve owner
conflicts through Scout's private support conversation after verifying the
request; no self-service unlink or ownership transfer is available.

## Related

- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
- [Roll out Scout Temporal](/how-to/roll-out-scout-temporal/)
