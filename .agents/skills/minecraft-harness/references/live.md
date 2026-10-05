# Live tsmc

Only for a change the user asked for. The operator procedure is the wiki
how-to "Operate The Storm with the agent harness".

```bash
toolkit mc live status        # refuses while asleep or mining-reset locked
toolkit mc cmd --target live --reason "daylight for screenshots" time set noon
toolkit mc build promote <dir> --target live --reason "<why>" [--confirm <hash>]
toolkit mc live journal --since 1d
toolkit mc live undo <journal-id> --reason "<why>"
```

- Asleep: ask the user to join ts-mc.net. Never scale the StatefulSet, edit
  mc-router annotations, or touch the mining-reset lock.
- No token (HTTP 412): the user restarts the daemon with the printed
  `MC_BRIDGE_TOKEN=$(op read …)` hint. Never print the token.
- Tier 1 (WorldEdit, paste, restore, actor block actions) is snapshotted first
  and undoable. Tier 2 (huge regions, `stop`, `kill`, `co rollback`, `//regen`)
  needs `toolkit mc live backup --wait --reason …`; dangerous commands also need
  `--confirm-dangerous`. Use `we`/`paste`, not `fill`/`setblock`.
- A human inside the box blocks the write; within 32 blocks needs
  `--allow-players`. Rehearse on a `storm-prod` sandbox first.
