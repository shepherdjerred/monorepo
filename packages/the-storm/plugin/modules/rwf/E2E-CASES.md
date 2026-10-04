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
Rewind clock lands on the trail.

MockBukkit cannot run `LivingEntity#attack`, sweep attacks, real knockback,
projectiles in flight, chunk tickets, `TextDisplay` billboards, `hasLineOfSight`
ray casts, the hurt animation, or Citizens NPCs, and it fires no vanilla
behaviour on its own. These cases need the real server in
`packages/the-storm/tests/e2e`. Each is a pass/fail check.

## World and maps

1. With `rwf` provisioned through Multiverse (any flat or void world) the
   module enables, seals the world, holds its 16 chunks, pastes the training
   yard at `0,64,0` and opens the lobby; with the world missing, TheStorm
   refuses to enable and the server stops.
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
7. Sweep attacks hit nobody; the 1.9 attack cooldown never applies (the
   `thestorm:rwf_attack_speed` modifier is present inside and gone after
   leaving); hunger stays at 20.
8. Knockback follows `Knockback.compute`: a sprinting attacker stops sprinting
   and keeps 0.6 of their speed; Knockback I and Punch III arrows push further.
9. Steak heals eight at once on right-click and is refused within a point of
   full health; golden apples eat as vanilla; the poison takes both away.
10. Deaths: no drops, no death message, the victim respawns at once at the
    spectator point in spectator mode, the killer and cause are attributed in
    the recording.

## Bombs and bots

11. Arming an enemy bomb alone takes nine seconds of fuse clicks; two arm in
    eight; the TNT block becomes floating primed TNT that never explodes on its
    own, the hologram counts down, and the owners defuse it by clicking the
    entity.
12. At zero the bomb explodes, every living owner dies, the radius-6 crater
    turns blocks to coal, and the reset puts them back.
13. The nuke in the middle is armed by either team and kills everyone else.
14. With rwfbots enabled, the countdown fills to `targetCombatants` with
    Citizens NPCs: they show `✦` after their names, carry the modifier, fight
    only through `CombatantActions`, and are never paid; without rwfbots the
    match runs humans only.
15. When the last human leaves a live match, bots are despawned and the match
    stops unpaid after `noHumansAbort`; when the last human leaves a countdown,
    the bots leave at once.

## Payouts and recordings

16. A win pays `round(3 x (0.25 + 0.75 x humanShare))` through the economy
    with reason `rwf:<matchId>:WIN` and idempotency key
    `rwf:<matchId>:<uuid>`; `kill -9` between the outbox write and the
    transfer pays exactly once on restart.
17. The daily cap forfeits the excess and tells the player.
18. `plugins/TheStorm/rwf-recordings/yyyy/MM/dd/<matchId>.rwfrec.gz` decodes
    with `RecordCodec`, names nobody, and holds frames at 20 Hz; `kill -9`
    during a match leaves a truncated file the next enable prunes by age.
19. With `recording.enabled: true` and `RWF_RECORDING_SALT` unset, enabling
    fails loudly; with it set, every joining human reads the disclosure.

## Rollout

20. `/rwf join` is refused while `the-storm-rwf-enabled` is false for the
    player in the configured Flipt environment, and admitted once it is true;
    with `FLIPT_URL` unset the command stays closed to everyone.
21. Bedrock (Geyser): holograms, the sidebar and messages render.
