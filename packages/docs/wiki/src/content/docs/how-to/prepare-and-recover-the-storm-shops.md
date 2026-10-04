---
title: Prepare and recover The Storm shops
description: Prepare protected rental plots and recover interrupted shop placement without losing a player's build or stock.
---

Prepare each rental's foundation and baseline before admitting players, then reconcile recovery journals before reopening interrupted work.

Use the [shop protection contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/README.md) to distinguish historical holdings from new rentals.

1. Survey the exact build and public paths in-game. Update the repository-owned parcel configuration with bounds and evidence. Leave owners empty when ownership or the editable boundary is uncertain. Apply configuration through the normal server release and confirm `/plot list` matches the survey.

2. For a new rental, prepare a solid foundation directly below its entire building volume. Keep roads, foundations and server infrastructure outside that volume. Clear the building volume and move entities out. Run `/plot admin baseline <plotId>` as staff and wait for the saved-baseline message. Investigate any failure before admitting a renter.

3. Rehearse renting, manual renewal, grace, reset and both mailbox choices on a disposable server. Confirm stock, decorations, locks and shop definitions survive the packed option. Verify a copied token cannot place twice. Enable new admissions only after accepting that behavior and the production baseline.

4. For overdue rent or interrupted placement, inspect the plugin's failure and retained journal before editing blocks. Run `/plot admin reconcile <operationUuid>` through authenticated RCON. Poll `/plot admin status <operationUuid>` until the operation completes or fails. If it reports busy, let pending trades or lock writes settle and retry with a new operation UUID. Move players, animals and loose items out of pending work volumes.

5. If a pending placement cannot safely continue, run `/plot admin rollback <recoveryId>`. Wait for completion before touching the reserved destination. Verify the destination is empty and the owner's token works again. A changed shop or lock identity requires staff reconciliation; preserve the archive and journal until resolved.

6. Ask the owner to read `/mail` and claim either `materials` or `packed` using the message's command. For packed recovery, have them right-click an empty location, inspect the preview, and use `/plot confirm`. If the token was lost, have the original owner use `/plot reissue <recoveryId>` and collect the replacement from mail.

7. After production acceptance, unpause the shop reconciliation schedule in Temporal namespace `prod`. Confirm its first run completes through the isolated infra Activity worker. Confirm a sleeping server is skipped without being woken. Keep new admissions closed if recovery verification fails.

## Related

- [Recover The Storm mining reset](/how-to/recover-the-storm-mining-reset/)
- [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
