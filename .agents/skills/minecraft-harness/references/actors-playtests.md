# Actors and playtests

Actors are Citizens player NPCs (`paper` and `storm-dev` profiles). Use them to
exercise plugin behavior as a player would:

```bash
toolkit mc actor spawn alice --at 0,-60,0 --op
toolkit mc actor act alice goto --pos 5,-60,5
toolkit mc actor act alice use --pos 4,-60,1     # fires PlayerInteractEvent
toolkit mc actor act alice command /spawn
toolkit mc actor observe alice                   # inventory, nearby, recent events
```

For a repeatable check, write a scenario (`toolkit mc playtest new <name>
--dir packages/<pkg>/playtests`) and run it; with no `--target` a fresh sandbox
is created from the scenario's profile and removed afterwards:

```bash
mise exec -- gradle -p packages/the-storm/plugin assemble   # MCBridge + TheStorm jars
toolkit mc playtest run packages/the-storm/playtests
toolkit mc playtest show <run-id>                           # steps, failed assertions, tails
```

On failure read `report.json`: the failing step, each actor's observation and
the event tail usually explain it.

## Limits

- Actors receive no chat or messages, never join, and cannot drive client UI
  (dialogs, inventories); prove those with the-storm's Mineflayer E2E suite.
- A denied `use` still reports `ok: true`, so assert effects.
- Playtests never run against live servers.
