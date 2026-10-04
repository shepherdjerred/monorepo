# rwfbots: cases for the real-server e2e harness

Unit and MockBukkit tests cover the pure think stack (perception, tactics,
team, reflex, the headless sim), the think loop (coalescing, staggering,
epochs, the ray budget, a real worker thread), the governor's hysteresis, the
director's draft and shift, OpenSkill settlement, config and nav artifact
loading with the stale-artifact refusal, the jOOQ stats store, gzip trace
files, the snapshot capture, the body driver, and on MockBukkit a whole match
with fake bodies over a fake rwf match: lobby fill and kit picks, live thinking
and movement, new lives on death, rating and trace files at the end, the debug
command and despawn on disable. Bot chat's director (moments, chances,
cooldowns, the rate limit, no repeats, placeholders, determinism) is unit
tested, and on MockBukkit a bot's kill is said once, from its own kill lines
with the `✦` marker, to the players in the rwf world only, and not at all with
the flag off.

MockBukkit cannot run Citizens, and the fake match stands in for rwf. These
cases need the real server with Citizens installed. Each is a pass/fail check.

`tests/full/rwfbots.e2e.test.ts` runs them on the full lane, which boots every
shipped module plus rwf and rwfbots, Citizens with its owned config, and the
owned rwf.yml under the suite's short countdown. A case marked **proven** is
asserted there; the load cases belong to the manual load profile
(`bun run test:load`, `tests/load/rwf-load.e2e.test.ts`), whose 20, 50 and
100 bot numbers at 4 and 6 CPUs are recorded in `LOAD.md` beside this file.

## Bodies

1. TheStorm requires Citizens in `paper-plugin.yml`, so without it TheStorm
   does not load at all; `rwfbots` still fails its enable naming Citizens if
   the API has no implementation. With Citizens present the module logs its
   personality and map counts. **Proven** with Citizens present (20
   personalities, 1 map with a nav artifact, traces on).
2. A drafted bot spawns as a player NPC with its personality's skin and name,
   is not in `getOnlinePlayers()`, does not count towards max players, and
   carries the `✦` suffix rwf's scoreboard gives bots. **Proven**: the
   client receives each drafted bot's profile with its personality's signed
   texture (value and signature, applied from the file with no Mojang call),
   `list` keeps the same count and maximum and names none of them, each bot
   joins a `rwf_<team>_bot` team whose suffix is `✦`, and `/rwf who` shows
   it.
3. Some 35 to 50 ticks after spawn the skin applies and Citizens replaces the
   entity (`PENDING_RESPAWN` then `RESPAWN`): the bot keeps moving the next
   tick, its UUID is unchanged, `/rwfbots debug` still lists it, and its
   attack-speed base is 1024 again. Not inspected directly; the bodies are
   identified by the entity UUID (`NPC#getMinecraftUniqueId`, which Citizens
   derives from the NPC's), and every later case runs across the swap.
4. A bot takes rwf's damage and knockback from a human's sword and from a
   Punch arrow; it dies, respawns at the spectator point and its body is
   despawned when rwf restores it. **Proven** in part: bots die to the
   rules' damage from other bots, each death is recorded once (as `died`,
   with the killer for combat deaths) and counted once in the personality
   record, and every body is gone after the match. A human's hits on a bot,
   knockback and the spectator respawn are not inspected.

## Movement and fighting

5. At live, bots on both teams leave their spawns along the nav artifact's
   paths, step up single blocks and jump where a waypoint says to.
   **Proven** that bots on both teams move more than four blocks from their
   spawns within 30 s (positions from the human's client); steps and jumps
   are not.
6. A bot within reach of an enemy swings at the rules' CPS, lands only hits
   that pass `CombatantActions.melee` (reach, line of sight, hit window), and
   strafes; a bow kit draws for 20 ticks and fires an arrow that reaches a
   target ten blocks away. **Proven** in part: with the human placed beside
   enemy bots, a bot's sword or arrow lowers the human's health, and the
   recording holds bot `attack` intents (written only for swings that pass
   reach, line of sight and the hit window). CPS, strafing and the bow's draw
   are not inspected.
7. A Trooper below ten health with no enemy within four blocks eats a golden
   apple to completion (32 ticks) and gains absorption; an enemy arriving
   mid-bite interrupts it. **Proven** for the bite: at live, while the teams
   stand at their bases, every drafted Trooper without the `never_eats` or
   `gapple_hoarder` quirk is dropped to 8 health, and within 15 s one gains
   absorption and holds two of its three apples (a draft without such a
   Trooper is abandoned for a fresh one, up to four times). The interruption
   is not.
8. Bots arm an enemy bomb with fuse clicks about 300 ms apart, stack on the
   fuse, and defuse their own armed bomb through the same port; the planter's
   `Armed` stat reaches the personality record. **Proven** in part: in every
   played match the recording holds bot fuse clicks on a bomb that is not
   their own (an enemy bomb or the nuke); click spacing, stacking, defuses
   and the stat are not asserted.
9. A Rewind bot uses the Time Machine through the rules; the teleport starts
   a new life (its decision age resets in `/rwfbots debug`).

## Load and recovery

10. With 7 bots on `training-yard` the bot sections stay under 6 ms and the
    governor stays at level 0; forcing tick times above 40 ms (a busy
    `/debug` or an artificial stall) for two seconds moves it to level 1,
    bots far from every human update every other tick, and calm ticks bring
    it back one level at a time. **Proven** for level 0 with 7 bots
    (staleness p95 within `maxDecisionAgeTicks`), and by the load profile
    (`LOAD.md`) for level 0 at 20, 50 and 100 bots on 4 and 6 CPUs against
    the plan's bars:
    - no think job over a tick;
    - staleness, the think loop's lag from snapshot to published decision,
      at a p95 of 0 to 1 tick against the 3-tick bar;
    - bot sections p95 at most 6.4 ms at 100 bots;
    - the added tick p95 at 100 bots 3.8 and 6.1 ms on 4 CPUs, the tested
      shape. It is marginal on 6 CPUs: 8.3 ms in one run, over the 8 ms bar.

    The age of the decision each bot follows is about 5 ticks by design (4 Hz
    tactics); it is reported, not judged. The forced stall and the recovery
    are not proven.

11. A match whose map folder has no `nav.rwfnav`, or one baked from other
    blocks, logs the problem at enable or map choice and runs humans-only;
    `/rwf join` still works.
12. After a finished match `rwfbots_personality_stats` has a row per bot with
    the winner's `mu` up and the loser's down, and
    `plugins/TheStorm/rwfbots-traces/<matchId>.gz` decodes to `decision`
    lines. **Proven**: the log reports seven personalities rated, each
    drafted personality's row gains one match, a win only for the winning
    team and at most one death, and the trace is a gzip of `decision` lines;
    the direction of `mu` is not asserted. A bots-only showcase rates all
    eight of its personalities, and a stopped match rates nobody.
13. `/stop` during a live match despawns every NPC, closes the trace file,
    and the in-memory registry leaves nothing in Citizens' saves. **Proven**
    for the registry: during a live match with seven bots, after
    `citizens save`, Citizens' own (saved) registry lists none of them in
    `npc list`, nor after the match. `/stop` itself is not run: both the local
    and the CI lane share one server across every suite file, so stopping it
    would end the run for the files after it.

## Chat

14. With `the-storm-rwfbots-chat-enabled` on, bots talk during a live match:
    a watcher's and a member's client in the rwf world receive
    `[Name ✦]: line` messages from the match's personalities, a player in
    the main world receives none, and nothing reaches the Discord relay.
    **Proven** in part by the showcase case: the watcher hears at least one
    `✦` line from a shipped personality and a player in the main world hears
    none. Discord, a member's client, the name's team colour and the pacing
    (gap, window, cooldowns) on the real server are not inspected.
15. Turning the flag off in Flipt silences the bots within
    `flagRefreshSeconds` without a restart, and turning it back on brings
    them back; a Flipt outage keeps them silent and logs a warning.
