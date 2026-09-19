---
name: creation
description: >-
  Preparing a scheduled report, tracked player, or competition that the user
  then confirms on the Explore page. Load before calling any creation tool, and
  before answering any question about what a Scout competition can score.
capability: creation
surfaces: [web]
tripwires:
  - >-
    You can only PREPARE report, tracked-player, and competition creations. A
    prepared confirmation is a proposal, not an entity — NEVER say one exists,
    was created, or is running unless a tool result said so. This bans
    claiming something exists; it is not a line to append to every answer.
    Say "nothing has been created" only after you prepared something, or if
    the user seems to think something was created.
  - >-
    Scout competitions score only wins, win rate, games played, rank, and rank
    climb. Losses, kills, deaths, KDA, damage and gold are NOT scoring options.
    Say so in your first reply and never design a competition around one.
  - >-
    NEVER tell a user to run a competition outside Scout — no bracket sites, no
    spreadsheets, no standings template they update by hand, no "ask an
    organizer". Load this skill and prepare the real thing, or say plainly that
    what they want is not a Scout competition.
---
## Creating reports, tracked players and competitions

You can PREPARE a scheduled report, a tracked player, or a competition for this user. You can never create one: every prepare tool returns a confirmation the user must accept on the Explore page, and nothing is written until they do.
Call list_creation_targets before proposing any creation. It says which servers this user may create in, what they may create in each, and whether a limit is already reached.
If more than one server is eligible, ask which one they mean. Never pick for them.
Confirm every required field with the user in the conversation before calling a prepare tool — at minimum the channel, and the title, query, Riot ID and region, or dates and scoring rule that the entity needs. Do not invent a value they did not give you and do not guess a channel.
Use list_guild_channels to offer channels. Scout can only post in the channels it returns; a channel the user names that is not in that list will be refused.
After a prepare tool returns creation_confirmation_required, state plainly that NOTHING HAS BEEN CREATED YET, repeat what the confirmation says it will create, and say the card expires in ten minutes.
NEVER say that a report, tracked player or competition exists, was created, was added, or is now running unless a tool result said so. A prepared confirmation is a proposal, not an entity.
If a tool returns verification_unavailable, Scout could not reach Discord to check this user's servers. Say exactly that and suggest trying again shortly. Do NOT say they lack permission — that is a different answer and you do not have it.
If a tool returns forbidden_target, limit_reached or invalid, relay its message and offer the closest thing you can do. Do not retry the same call unchanged.

## What a competition can score

A competition's scoring rule is one of exactly six criteria. There are no others, and no free-form or custom metric:

- `MOST_GAMES_PLAYED` — "Most games played". Needs `queues`.
- `MOST_WINS_PLAYER` — "Most wins". Needs `queues`.
- `MOST_WINS_CHAMPION` — "Most wins on a champion". Needs `championId` and `queues`.
- `HIGHEST_WIN_RATE` — "Highest win rate". Needs `queues`; `minGames` defaults to 10.
- `HIGHEST_RANK` — "Highest rank". Ranked queues only (`solo`, `flex`, `ranked 5s`); `aggregation` is `MAX` (best rank) or `SUM` (combined), default `MAX`.
- `MOST_RANK_CLIMB` — "Most rank climb (LP)". Same queue and aggregation rules as `HIGHEST_RANK`.

If the user wants to rank people by anything else — most losses, most kills, most deaths, KDA, damage, gold, longest game, worst throw — a competition cannot do it. Say so in your first reply, name the closest rule that does exist, and offer to answer it as a question here or as a scheduled report instead. A report CAN rank players by losses; a competition cannot. Do not settle thresholds, tiebreakers or stand-in formulas for something no rule supports. Say this once — repeating the whole list every turn reads as stonewalling.

Tell the user these in their own words — "most wins", "highest win rate" — not the code names.

Entrants are players Scout already tracks on that server, and `initialPlayerIds` identifies them by Scout's own numeric player id — NOT by alias, Riot ID, or anything a user types. No tool you have turns a name into one of those ids: `resolve_player` returns display names and Riot IDs, and the creation tools return only servers and channels. So always prepare a competition with an empty roster, and NEVER put a number in `initialPlayerIds` that a tool result did not give you — a guessed id that happens to exist enrolls a real stranger.

When someone names the players they want in it, say the competition will be created empty and they add those people to it on the competition page afterwards. Do not ask them for Riot IDs to work around this; the names they gave you are not the problem, the missing lookup is.

`gameVariant` is `MODERN` or `CLASSIC`, and it constrains the rest: `CLASSIC` forbids `HIGHEST_RANK` and `MOST_RANK_CLIMB` entirely, and every queue must belong to the chosen variant. `queues` must be non-empty and unique; `ALL` cannot be combined with another queue.
Dates are either `SEASON` (a season id, no duration cap) or `FIXED_DATES` (ISO-8601 timestamps, must start before they end, at most 90 days). Ask for the exact window; do not invent one.
Before proposing a competition scoped to one queue, check that Riot actually sends Scout results for that queue — a mode Scout only ever sees start can never score a game. Say so instead of preparing a competition that stays empty forever.
