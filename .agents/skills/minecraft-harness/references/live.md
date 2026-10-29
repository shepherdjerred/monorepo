# Live tsmc

Only for a change the user asked for. The operator procedure is the wiki
how-to "Operate The Storm with the agent harness".

```bash
toolkit mc live status        # refuses while asleep or restoration-leased
toolkit mc cmd --target live --reason "daylight for screenshots" time set noon
toolkit mc build promote <dir> --target live --reason "<why>" [--confirm <hash>]
toolkit mc live journal --since 1d
toolkit mc live undo <journal-id> --reason "<why>"
```

- Asleep: ask the user to join ts-mc.net. Never scale the StatefulSet, edit
  mc-router annotations, or touch the world-restoration lease.
- No token (HTTP 412): restart the daemon from the repository root with the
  printed `scripts/onepassword/with-service-account.sh` hint. It reads the
  token through the Keychain service account; never print the token.
- Tier 1 (WorldEdit, paste, restore, actor block actions) is snapshotted first
  and undoable. Tier 2 (huge regions, `stop`, `kill`, `co rollback`, `//regen`)
  is not undoable; scheduled Velero backups are the only backup, and dangerous
  commands need `--confirm-dangerous`. Use `we`/`paste`, not `fill`/`setblock`.
- A human inside the box blocks the write; within 32 blocks needs
  `--allow-players`. Rehearse on a `storm-prod` sandbox first.
