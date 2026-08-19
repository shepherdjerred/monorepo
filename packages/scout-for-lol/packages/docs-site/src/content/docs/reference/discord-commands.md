---
title: Discord commands
description: Every slash command Scout registers, its options, and what it replies with.
sidebar:
  order: 1
---

Scout registers seven global slash commands. It also registers `/scout` only in
servers enabled for the Explore beta. Command replies are **ephemeral** — visible
only to the person who ran the command — unless the asker explicitly chooses
**Post publicly** on a completed Scout answer.

## Command summary

| Command   | Description                                     | Options         |
| --------- | ----------------------------------------------- | --------------- |
| `/help`   | Get help and view Scout's lightweight commands  | none            |
| `/setup`  | See the recommended Scout setup flow            | none            |
| `/status` | Check Scout's connection status                 | none            |
| `/invite` | Add Scout to another Discord server             | none            |
| `/docs`   | Open Scout's documentation                      | none            |
| `/track`  | Track one League player in this Discord channel | 3, all required |
| `/list`   | List the players Scout tracks for this server   | none            |

In Explore-enabled servers, Scout also registers this guild-scoped command:

| Command      | Description                                   | Options              |
| ------------ | --------------------------------------------- | -------------------- |
| `/scout ask` | Ask a private question about Scout match data | `question`, required |

![The Discord slash-command entry for /track, showing the riot-id, region, and alias option pills with the riot-id hint "Riot ID, for example Faker#KR1".](../../../assets/discord-track-options.png)

## `/track`

Creates a player, a Riot account, and a subscription posting to **the channel
the command was run in**.

| Option    | Type   | Required | Description                                                     |
| --------- | ------ | -------- | --------------------------------------------------------------- |
| `riot-id` | string | yes      | Riot ID including the tag, for example `Faker#KR1`              |
| `region`  | choice | yes      | League region, picked from a dropdown of every supported region |
| `alias`   | string | yes      | Short display name for the player, 1–100 characters             |

Requires the Discord **Administrator** permission, like the `/subscription add`
command it replaces — tracking a player consumes the server's quotas and creates
recurring posts in a channel.

The new subscription is created with **no queue filter**, so it posts every
queue. It cannot set filters, additional channels, or a Discord link; use the
dashboard for those.

![Discord showing the region choice list for /track: BRAZIL, EU_EAST, EU_WEST, KOREA, LAT_NORTH, LAT_SOUTH, AMERICA_NORTH, OCEANIA, TURKEY, RUSSIA, JAPAN, VIETNAM and more.](../../../assets/discord-track-regions.png)

Must be run inside a server. Region values are listed in [Queues and
regions](/docs/reference/queues-and-regions/).

### Replies

| Situation                                        | Reply                                                      |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Created                                          | Confirms the alias is now tracked in this channel          |
| Riot account already tracked under another alias | Names the existing alias and how many channels it posts to |
| Already tracked in this channel                  | Says so and links the dashboard                            |
| Server subscription limit reached                | Reports current count and maximum                          |
| Server account limit reached                     | Reports current count and maximum                          |
| Riot ID not found                                | Reports that the Riot ID could not be resolved             |

![The ephemeral reply to /track: a green tick, "Now tracking Faker in this channel. Scout will post match notifications here.", a dashboard link, and the "Only you can see this" marker.](../../../assets/discord-track-reply.png)

## `/list`

Returns an embed titled **Scout tracked players**, with one field per
subscription showing the player alias and its destination channel.

Shows at most **25** subscriptions. When more exist, the embed footer says so
and directs you to the dashboard.

Must be run inside a server.

![The /list embed, listing tracked player aliases with their destination channel and a footer reading "Showing the first 25. Open the dashboard for the complete list."](../../../assets/discord-list.png)

## `/status`

Reports that Scout is online, names the current server, and gives the Discord
gateway latency in milliseconds.

## `/help`

An embed containing the dashboard URL, the documentation URL, the command list,
and a summary of what the dashboard is for. It includes `/scout ask` only when
run inside an Explore-enabled server.

![The /help embed listing the dashboard and documentation links, the lightweight commands with one-line descriptions, and what the dashboard is for.](../../../assets/discord-help.png)

## `/scout ask`

Asks Scout Explore a one-shot question over the match data Scout has ingested.
The `question` option accepts 1–2,000 characters. The command is available only
in servers listed by the operator-managed Explore allowlist and does not work in
direct messages.

Each invocation starts a **new saved Explore conversation** owned by the Discord
user who ran it. The answer is initially private and can include caveats and a
generated chart. Two buttons are shown:

- **Open in Explore** opens the saved conversation in the stage-correct web app.
- **Post publicly** copies the stored question, answer, caveats, and chart into
  the channel, then changes to **Posted**.

Publishing uses the frozen saved result. It does not run the model or ScoutQL
again, does not create a public Explore share link, and does not include the raw
ScoutQL, tool trace, or owner-only Explore URL. Generated text cannot mention
Discord users or roles.

Discord is deliberately one-shot: use **Open in Explore** for follow-up
questions, conversation history, branching, sharing, and other Explore tools.
Failed validation and runtime errors stay private. If a public post fails, its
button remains available to retry the same saved result.

## `/setup`, `/invite`, `/docs`

Link-only commands:

- `/setup` — the dashboard URL and the recommended setup order.
- `/invite` — an install URL for adding Scout to another server.
- `/docs` — the documentation URL for the stage you are on. On beta this points
  at the beta documentation, not production.

## What is deliberately not a command

Filters, additional channels, queue selection, mute, competitions, saved report
configuration, roles, permissions, audit history, merges, transfers, Discord
links, and Explore follow-ups are dashboard-only. See [Why Scout is
web-first](/docs/explanation/web-first/).

## Related

- [Dashboard reference](/docs/reference/dashboard/)
- [Add and organize tracked players](/docs/how-to/add-players/)
