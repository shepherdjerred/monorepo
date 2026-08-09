---
title: How players, accounts, and subscriptions relate
description: Why Scout separates the person, the League account, and the delivery — and what goes wrong when they get conflated.
sidebar:
  order: 2
---

Scout models three things, and nearly every confusion about it comes from
collapsing them into one.

- A **player** is a person, as your server knows them: an alias.
- A **Riot account** is one League account. A player can have several.
- A **subscription** is a decision to post one player's matches into one
  channel. A player can have several of those too.

So a player has many accounts, and a player has many subscriptions, and those
two relationships are independent of each other.

## Why the player is not the account

The obvious design would be to track League accounts directly. Scout does not,
for two reasons.

The first is smurfs. People play on more than one account, and a leaderboard
that lists someone twice — once per account, each with a fraction of their games
— is not measuring anything anyone cares about. Grouping accounts under a player
means the aggregate is per _person_, which is what a server actually wants to
rank.

The second is that in-game names change. Riot IDs are editable, so a system
keyed on them would lose track of who someone is whenever they renamed. The
alias is your server's name for them, stable regardless of what Riot says today.

The cost is that Scout cannot know two accounts are the same person. Someone has
to say so, and if nobody does you get [duplicate
players](/docs/how-to/fix-duplicate-players/) — the most common way a Scout
setup goes wrong.

## Why the subscription is not the player

Tracking someone and posting their games look like the same act, but they are
not, and separating them buys the arrangement most servers eventually want:
ranked in one channel, ARAM in another, someone muted for a fortnight without
being untracked.

Because subscriptions are separate objects, each carries its own queue filter
and its own mute state. Adding a second channel does not duplicate the player,
and muting one channel does not affect the other.

This also makes mute meaningfully different from delete. Muting keeps the
subscription, its filters, and its history, and is the right move for a
temporary pause. Deleting throws that away — which is why moving a subscription
between channels is a first-class action rather than something you do by
deleting and recreating.

## Aliases are per server

A player is scoped to one Discord server. The same person tracked in two servers
is two players, and each server can call them whatever it likes.

That is deliberate: servers are separate social contexts with separate rosters,
and one server should not be able to see or affect another's configuration. The
tradeoff is that setup is not shared — joining Scout to a second server means
adding players there too.

## Deleting one thing does not delete another

The hierarchy decides what cascades:

- Deleting an **account** stops following that League account; the player and
  their other accounts remain.
- Deleting a **player** removes their subscriptions with them.
- Deleting a **subscription** removes only the delivery to that channel; the
  player stays tracked.

Nothing removes messages Scout already posted — those are ordinary Discord
messages your server owns.

## Merging versus transferring

Two operations look similar and mean opposite things:

- **Merging** two players says _these were always the same person_. Their
  accounts and history combine under one alias.
- **Transferring** an account says _this account belongs to someone else_. The
  two players remain distinct people.

Reaching for merge when you meant transfer silently fuses two people's records
into one. The [audit log](/docs/reference/dashboard/) is how you find out that
happened, and it is a good argument for restricting who can do either.

## Related

- [Add and organize tracked players](/docs/how-to/add-players/)
- [Fix duplicate or mis-assigned players](/docs/how-to/fix-duplicate-players/)
- [Route notifications to the right channels](/docs/how-to/route-notifications/)
