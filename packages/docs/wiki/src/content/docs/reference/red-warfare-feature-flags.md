---
title: Red Warfare feature flags reference
description: Gameplay gates, declared environment values, targeting and refresh boundaries for Red Warfare and its bots.
---

Red Warfare's managed flags control admission, match features, kits, rewards
and independent bot and archive services. The
[managed inventory](packages/feature-flags/src/managed-flag-inventory.json)
owns their declarations, environment overrides and targeting.

## Gameplay gates

These flags use namespace `the-storm`. Each declaration defaults to `false`;
the `beta` and `prod` overrides are `true` without targeting rules.

| Flag                                    | Enabled behavior                                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `the-storm-rwf-enabled`                 | Admission through `/rwf join` and the spectator commands.                                                                                                                                                                                      |
| `the-storm-rwf-match-flow-enabled`      | Three maps appear on the lobby ballot. Members vote with `/rwf vote` or podiums until `voteLead`; seeded draws break ties. The selected map previews for `previewLength` with kits open, then teams freeze at their starts for `freezeLength`. |
| `the-storm-rwf-carry-over-enabled`      | Humans retain their kits and held belongings into the next lobby after a natural finish, without `/rwf join`. Bots and leavers are restored. A stop releases everyone.                                                                         |
| `the-storm-rwf-death-feed-enabled`      | Team-coloured death messages, tab-list kills, `Scored a kill assist worth n!`, `Stolen a kill!`, and the killer's remaining hearts for the victim. Assists need more than a tenth of the damage.                                               |
| `the-storm-rwf-team-chat-enabled`       | Plain chat goes to the team (`/t`); `@` or `/g` speaks globally. `/rwf teamchat` changes the remembered default. Dead players and watchers share `/dead`.                                                                                      |
| `the-storm-rwf-spectator-tools-enabled` | The dead watch their killer for three seconds, then get a compass menu, `/rwf spectate next`, `/rwf spectate previous` and `/rwf goto`. Ghosts and Wraiths stay hidden.                                                                        |
| `the-storm-rwf-bomb-effects-enabled`    | Map-wide explosion audio and particles, armed-bomb hiss and smoke, and a ten-segment arming bar per team on bomb holograms.                                                                                                                    |
| `the-storm-rwf-stats-enabled`           | Stats commands, lobby leaderboards and persistent lifetime and per-kit totals.                                                                                                                                                                 |
| `the-storm-rwf-kits-enabled`            | The full kit list, credit shop and weekly free rotation. When off, access is limited to Trooper, Longbow, Shortbow and Rewind.                                                                                                                 |
| `the-storm-rwf-killstreaks-enabled`     | Tracking compass at two kills, wolves and supply crates every four, iron golems every eight and napalm every eleven; assists contribute their share.                                                                                           |

Admission is implemented by
[FliptRwfGate](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote/FliptRwfGate.java).
The seven match features are declared by
[FliptRwfFeatures](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote/FliptRwfFeatures.java)
and applied by
[MatchRunner](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/paper/MatchRunner.java).
The kit gate and restricted access are defined by
[FliptRwfKitsGate](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote/FliptRwfKitsGate.java)
and [Armory](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/paper/Armory.java).
Reward thresholds come from
[Killstreak](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/domain/killstreak/Killstreak.java).

## Evaluation and cache boundaries

| Gate                 | Targeting and refresh                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission            | Player UUID with the map world as `world` context, evaluated for the admission request.                                                              |
| Seven match features | Fixed entity `the-storm-rwf-features` with the map world as `world` context, read as each lobby opens. The active match keeps its captured features. |
| Kits                 | Player UUID with `world` context, evaluated when that player's armory loads. The answer remains cached until disconnect.                             |
| Killstreaks          | Player UUID with `world` context, evaluated for each earned reward before delivery.                                                                  |

Successful admission starts a kit load through
[KitPicker](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/paper/KitPicker.java).
Browsing or buying through
[KitMenus](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/paper/KitMenus.java)
can also load the armory. An ordinary server login does not load it;
[PlayerListener](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/paper/PlayerListener.java)
clears the cache on quit.

[FliptPlayerFlag](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote/FliptPlayerFlag.java)
implements player targeting;
[Killstreaks](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/adapter/paper/Killstreaks.java)
checks the flag when granting a reward.
Missing `FLIPT_URL` or `FLIPT_ENVIRONMENT` closes admission, kits and rewards,
and leaves match features off at startup, as wired by
[RwfModule](packages/the-storm/plugin/modules/rwf/src/main/java/com/shepherdjerred/thestorm/rwf/RwfModule.java).
A failed later match-feature refresh preserves the previous captured features.

## Independent controls

These declarations also default to `false`. Environment values below include
inherited defaults when no override exists; the inventory declares no targeting
for these controls.

| Flag                                      | Declared environment values                   |
| ----------------------------------------- | --------------------------------------------- |
| `the-storm-rwfbots-chat-enabled`          | Namespace `the-storm`; beta and prod `true`.  |
| `the-storm-rwfbots-learning-enabled`      | Namespace `the-storm`; beta and prod `false`. |
| `the-storm-rwf-recording-archive-enabled` | Namespace `temporal`; beta and prod `false`.  |

Bot speech also requires `chat.enabled` in `rwfbots.yml`.
Bot chat uses fixed entity `the-storm-rwfbots-chat` with `world` context.
Its answer refreshes every `chat.flagRefreshSeconds`; the
[shipped configuration](packages/the-storm/server/owned/plugins/TheStorm/rwfbots.yml)
enables chat and sets that interval to 30 seconds.
[FliptChatGate](packages/the-storm/plugin/modules/rwfbots/src/main/java/com/shepherdjerred/thestorm/rwfbots/adapter/remote/FliptChatGate.java)
and [RwfBotsPaper](packages/the-storm/plugin/modules/rwfbots/src/main/java/com/shepherdjerred/thestorm/rwfbots/adapter/paper/RwfBotsPaper.java)
implement the gate and refresh loop.

Learning gates accepted Trooper combat movement and attack timing separately
from ordinary authored bots. It is evaluated once at the live transition, with the match UUID as
entity and match, map and world context. It also requires an accepted model
bundle; changing the flag does not publish or install that artifact. These
contracts live in
[FliptLearningGate](packages/the-storm/plugin/modules/rwfbots/src/main/java/com/shepherdjerred/thestorm/rwfbots/adapter/remote/FliptLearningGate.java)
and [MatchLearning](packages/the-storm/plugin/modules/rwfbots/src/main/java/com/shepherdjerred/thestorm/rwfbots/app/learning/MatchLearning.java).

The archive copies finished recordings; its gate does not control the plugin's
recording collection. It evaluates its flag for each hourly scheduled run. Its production
targeting key is `the-storm-rwf-recording-archive-prod`, with `environment`
context. The
[archive configuration](packages/temporal/src/config/rwf-recording-archive.ts),
[schedule definition](packages/temporal/src/schedules/minecraft-schedule-definitions.ts)
and [workflow](packages/temporal/src/workflows/homelab/rwf-recording-archive.ts)
own its worker and storage contract.

## Related

- [Provision the Search and Destroy worlds](/how-to/provision-the-storm-search-and-destroy-world/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
