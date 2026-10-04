# rwf: cases for the real-server e2e harness

Unit, repository and MockBukkit tests cover the match state machine, bombs,
poison, combat formulas and kits; content loading and every refusal; the
schematic reader; snapshot, match and payout storage; the payout outbox with
its daily cap and replay; the recorder (decodable with `RecordCodec`,
pseudonymous, pruned by age and size); and on MockBukkit: enabling pastes and
verifies the training yard and seals the world; join snapshots and clears a
player into the lobby with the attack-speed modifier and the recording
disclosure; leave, disconnect and a crash's snapshot all restore exactly; the
fuse cannot be dropped or moved out of slot 0; hunger never drops; members
cannot teleport out and outsiders cannot teleport in; bots fill the countdown
and leave when the last human does; a human arms a bomb through the real
interact listener and a bot defuses it through `CombatantActions`; the rules'
damage replaces the server's and the hit window refuses a second hit; a win
pays through the outbox, writes a recording and resets the map; a dead member
spectates after respawning; a live match with no humans is stopped unpaid; the
Rewind clock lands on the trail. Watching: `/rwf spectate` snapshots under
`rwf_watch` and puts the watcher in spectator mode at the spectator point;
leave, quit, the module stopping and a crash's snapshot all restore exactly;
watchers are never combatants, never get the modifier and never keep a match
alive (a match with only a watcher left is still stopped); `/rwf spectate
next` cycles the living fighters; a member cannot watch; a watcher who joins
keeps their original snapshot. Showcases: refused without the bot roster and
while humans play; a bots-only showcase fills to its size, runs past the
no-humans abort, refuses joining humans, ends by elimination, pays nobody,
records an all-bot roster and reopens a normal lobby.

MockBukkit cannot run `LivingEntity#attack`, sweep attacks, real knockback,
projectiles in flight, chunk tickets, `TextDisplay` billboards, `hasLineOfSight`
ray casts, the hurt animation, or Citizens NPCs, and it fires no vanilla
behaviour on its own. These cases need the real server in
`packages/the-storm/tests/e2e`. Each is a pass/fail check.

`tests/e2e/rwf.e2e.test.ts` runs humans only (rwfbots off) on the shared e2e
server, whose fixtures plugin creates the flat void `rwf` world before TheStorm
enables. `tests/full/rwfbots.e2e.test.ts` runs the bot cases (14, 15, 16's
human share, 23) on the full lane, where every shipped module plus rwf and
rwfbots boots with Citizens. A case marked **proven** below is asserted in one
of the two; the rest still wait for a suite.

## World and maps

1. With `rwf` provisioned through Multiverse (any flat or void world) the
   module enables, seals the world, holds its 16 chunks, pastes the training
   yard at `0,64,0` and opens the lobby; with the world missing, TheStorm
   refuses to enable and the server stops. **Proven** (the happy path: the
   module enables on the fixture world, `/rwf admin status` reports the
   training yard ready, the TNT blocks stand at the bomb sites); the missing
   world is not.
2. Break a block inside the yard as an operator, then restart: the verifier
   hashes the region, logs the mismatch and re-pastes it before admission opens.
3. `/rwf admin repair` between matches reports an intact map, or re-pastes a
   damaged one.
4. Game rules hold: no mob spawning, no fire spread, time and weather frozen,
   no death messages, immediate respawn, no advancement messages, TNT does not
   explode.
5. Nobody but staff (creative, spectator or `thestorm.rwf.admin`) can break,
   place, ignite or pour anything in the world, and nothing drops there.

## Combat

6. Two humans on different teams: a sword swing lands exactly the
   `DamageFormula` value (Trooper's Sharpness I iron sword on full iron: 2.9),
   armor and Protection are not applied twice, a second swing inside half the
   no-damage window is blocked, and a stronger one deals only the difference.
   **Proven** except the stronger-swing difference (both humans carry the same
   kit).
7. Sweep attacks hit nobody; the 1.9 attack cooldown never applies (the
   `thestorm:rwf_attack_speed` modifier is present inside and gone after
   leaving); hunger stays at 20. **Proven** for the modifier (attack speed
   reads 204 inside, 4 after) and for hunger (the food level holds at 20 under
   the Hunger effect while saturation drains); sweep attacks are not.
8. Knockback follows `Knockback.compute`: a sprinting attacker stops sprinting
   and keeps 0.6 of their speed; Knockback I and Punch III arrows push further.
9. Steak heals eight at once on right-click and is refused within a point of
   full health; golden apples eat as vanilla; the poison takes both away.
10. Deaths: no drops, no death message, the victim respawns at once at the
    spectator point in spectator mode, the killer and cause are attributed in
    the recording. **Proven** for a bomb's victim being in spectator mode
    during the end screen and counting one death; drops, messages and the
    recorded attribution are not inspected.

## Bombs and bots

11. Arming an enemy bomb alone takes nine seconds of fuse clicks; two arm in
    eight; the TNT block becomes floating primed TNT that never explodes on its
    own, the hologram counts down, and the owners defuse it by clicking the
    entity. **Proven** for one armer (the block becomes primed TNT that stays
    within a block of its site, the fuse warnings count down, an owner's
    clicks on the entity restore the block); two armers and the hologram text
    are not.
12. At zero the bomb explodes, every living owner dies, the radius-6 crater
    turns blocks to coal, and the reset puts them back. **Proven** for the
    explosion, the owner's death into spectator mode and the lobby reopening
    on an intact map; the crater's blocks are not inspected.
13. The nuke in the middle is armed by either team and kills everyone else.
14. With rwfbots enabled, the countdown fills to `targetCombatants` with
    Citizens NPCs: they show `✦` after their names, carry the modifier, fight
    only through `CombatantActions`, and are never paid; without rwfbots the
    match runs humans only. **Proven**: a lone human's countdown fills to the
    owned `targetCombatants` (8) with seven shipped personalities whose
    signed skins reach the client, none of them on the online list or its
    count; the scoreboard's `rwf_<team>_bot` teams carry the `✦` suffix and
    `/rwf who` shows it after every bot; bots' recorded swings go through
    `CombatantActions` and their hits lower the human's health; `rwf_match` counts 1 human
    and 7 bots and `rwf_match_player` holds the human alone. The humans-only
    half is proven by the e2e suite. The modifier on bot bodies is not
    inspected.
15. When the last human leaves a live match, bots are despawned and the match
    stops unpaid after `noHumansAbort`; when the last human leaves a countdown,
    the bots leave at once. Needs rwfbots: with humans only a departing human
    empties their team and standings end the match at once, so the abort never
    runs. **Proven** with rwfbots for the live match: the lone human
    disconnects, the match is stopped within the 5 s test abort (the log
    names the window), every bot despawns, the row has no winner, the human's
    row is `STOPPED` and unpaid, the bots are not rated and the balance is
    untouched; the countdown edge with bots is not. The humans-only edges are
    **proven** too: a lone human's match
    goes live and ends in the same tick (the empty team is defeated, nobody is
    paid, no bots are listed), a disconnect during the countdown cancels it,
    and leaving a live match hands the other team the win.

## Payouts and recordings

16. A win pays `round(3 x (0.25 + 0.75 x humanShare))` through the economy
    with reason `rwf:<matchId>:WIN` and idempotency key
    `rwf:<matchId>:<uuid>`; `kill -9` between the outbox write and the
    transfer pays exactly once on restart. **Proven** for the payout itself
    (3 to the winner, 1 to the loser, `/balance` and `rwf_match_player` agree,
    rows end `PAID`; a match shorter than `minMatchLength` pays nobody), and
    with bots for the human share (one human in eight: `round(3 x 0.34)` = 1
    for a win, 0 for a loss, the bots never paid); the crash replay is not.
17. The daily cap forfeits the excess and tells the player.
18. `plugins/TheStorm/rwf-recordings/yyyy/MM/dd/<matchId>.rwfrec.gz` decodes
    with `RecordCodec`, names nobody, and holds frames at 20 Hz; `kill -9`
    during a match leaves a truncated file the next enable prunes by age.
    **Proven** that the file exists at that path, is a non-empty gzip of the
    size `rwf_match` records, names the match and neither player, and dropped
    no frames; decoding and the crash prune are not.
19. With `recording.enabled: true` and `RWF_RECORDING_SALT` unset, enabling
    fails loudly; with it set, every joining human reads the disclosure.
    **Proven** for the disclosure with the salt set; the missing salt is not.

## Rollout

20. `/rwf join` is refused while `the-storm-rwf-enabled` is false for the
    player in the configured Flipt environment, and admitted once it is true;
    with `FLIPT_URL` unset the command stays closed to everyone. **Proven** for
    admission (the fake brain's Flipt double answers `enabled: true` for the
    `rwf` world in `prod`); the refusals are not.
21. Bedrock (Geyser): holograms, the sidebar and messages render.

## Watching

22. `/rwf spectate` puts a player in spectator mode at the spectator point
    with the match scoreboard and empties them; they never count as a human
    (`/rwf admin status` lists them as watchers), a member's `/rwf spectate`
    is refused, the watcher stays through the end screen and the reset, and
    `/rwf leave` restores them exactly. **Proven** with one watcher and a lone
    human's match; the scoreboard, `/rwf spectate next`, a watcher joining
    and Bedrock rendering of the spectator view are not inspected.
23. With rwfbots enabled, `/rwf admin showcase 4` plays a whole bots-only
    match on Citizens NPCs while a human watches with `/rwf spectate next`
    following each fighter; it pays nobody, writes a recording and bot stats,
    and the next lobby fills bots only once a human joins. **Proven** with
    `/rwf admin showcase 8`: one watcher follows a bot with `/rwf spectate
next`, the bots-only match outlives the no-humans abort and ends with a
    winner, `rwf_match` records 0 humans and 8 bots with no player rows, the
    recording's roster is all bots, all eight personalities are rated, the
    next lobby has no bots, and `/rwf leave` restores the watcher; following
    every fighter in turn is not.
