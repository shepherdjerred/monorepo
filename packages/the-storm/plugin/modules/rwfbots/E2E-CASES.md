# rwfbots: cases for the real-server e2e harness

Unit and MockBukkit tests cover the pure think stack (perception, tactics,
team, reflex, the headless sim), the think loop (coalescing, staggering,
epochs, the ray budget, a real worker thread), the governor's hysteresis, the
director's draft and shift, OpenSkill settlement, config and nav artifact
loading with the stale-artifact refusal, the jOOQ stats store, gzip trace
files, the snapshot capture, the body driver, and on MockBukkit a whole match
with fake bodies over a fake rwf match: lobby fill and kit picks, live thinking
and movement, new lives on death, rating and trace files at the end, the debug
command and despawn on disable.

MockBukkit cannot run Citizens, and the fake match stands in for rwf. These
cases need the real server in `packages/the-storm/tests/e2e` with Citizens
installed. Each is a pass/fail check.

## Bodies

1. With Citizens absent, enabling `rwfbots` fails naming Citizens and the rest
   of TheStorm starts; with it present the module logs its personality and
   map counts.
2. A drafted bot spawns as a player NPC with its personality's skin and name,
   is not in `getOnlinePlayers()`, does not count towards max players, and
   carries the `✦` suffix rwf's scoreboard gives bots.
3. Some 35 to 50 ticks after spawn the skin applies and Citizens replaces the
   entity (`PENDING_RESPAWN` then `RESPAWN`): the bot keeps moving the next
   tick, its UUID is unchanged, `/rwfbots debug` still lists it, and its
   attack-speed base is 1024 again.
4. A bot takes rwf's damage and knockback from a human's sword and from a
   Punch arrow; it dies, respawns at the spectator point and its body is
   despawned when rwf restores it.

## Movement and fighting

5. At live, bots on both teams leave their spawns along the nav artifact's
   paths, step up single blocks and jump where a waypoint says to.
6. A bot within reach of an enemy swings at the rules' CPS, lands only hits
   that pass `CombatantActions.melee` (reach, line of sight, hit window), and
   strafes; a bow kit draws for 20 ticks and fires an arrow that reaches a
   target ten blocks away.
7. A Trooper below ten health with no enemy within four blocks eats a golden
   apple to completion (32 ticks) and gains absorption; an enemy arriving
   mid-bite interrupts it.
8. Bots arm an enemy bomb with fuse clicks about 300 ms apart, stack on the
   fuse, and defuse their own armed bomb through the same port; the planter's
   `Armed` stat reaches the personality record.
9. A Rewind bot uses the Time Machine through the rules; the teleport starts
   a new life (its decision age resets in `/rwfbots debug`).

## Load and recovery

10. With 7 bots on `training-yard` the bot sections stay under 6 ms and the
    governor stays at level 0; forcing tick times above 40 ms (a busy
    `/debug` or an artificial stall) for two seconds moves it to level 1,
    bots far from every human update every other tick, and calm ticks bring
    it back one level at a time.
11. A match whose map folder has no `nav.rwfnav`, or one baked from other
    blocks, logs the problem at enable or map choice and runs humans-only;
    `/rwf join` still works.
12. After a finished match `rwfbots_personality_stats` has a row per bot with
    the winner's `mu` up and the loser's down, and
    `plugins/TheStorm/rwfbots-traces/<matchId>.gz` decodes to `decision`
    lines.
13. `/stop` during a live match despawns every NPC, closes the trace file,
    and the in-memory registry leaves nothing in Citizens' saves.
