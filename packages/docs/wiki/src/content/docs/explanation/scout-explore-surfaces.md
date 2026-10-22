---
title: Why Explore is the same on every surface
description: Why web Explore, /scout ask and Scout Voice share one set of tools, skills, cards and creations, and what still differs between them.
sidebar:
  order: 9
---

Explore offers the same capabilities on the web, in Discord's `/scout ask` and
in Scout Voice. The surface changes how a question arrives and how the answer
is delivered. It never changes what Explore can do
([`surface.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/surface.ts)).

Explore used to filter by surface. Creating reports, player feeds and
competitions was web-only. Match and loadout cards never reached Discord, and
the builds guidance was not offered there. People noticed the difference.

- One user asked on Discord how to add a tracked player. Explore said it could
  not change the list from there.
- Another user, on the web, was setting up four player feeds in the same
  server at the same time.
- A Discord question about builds was answered without the builds guidance, and
  the answer recommended starter items.

A user does not know which surface has which rules. Every inconsistency read
as Scout being wrong.

## What differs, and why it is allowed to

Two kinds of difference remain, and neither is a capability.

**Delivery.** A Voice turn also writes a short spoken summary. Discord renders
cards as embeds and follow-up suggestions as buttons, while the web renders
both as components. Skills that only shape delivery declare the surfaces they
shape with `outputFor`. The skill loader rejects `outputFor` on any skill
gated by a capability, so a capability cannot quietly become web-only again
([`skills/loader.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/skills/loader.ts)).

**How Scout learns the asker's permissions.** A web session carries the
asker's Discord OAuth guild list. A `/scout ask` or Voice user has no OAuth
token, so Scout's bot answers instead. It checks membership, guild ownership
and the Administrator bit on the asker's roles, then reads the same Scout
grants. Both paths make the same decision and raise the same errors. An
unreachable Discord is reported as an outage, never as a missing permission
([`guild-permission.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/trpc/guild-permission.ts),
[`creation/capability.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/creation/capability.ts)).

## Confirmations stay with the person who asked

Explore prepares a creation and never performs it. A confirmation card holds
the proposal until its owner accepts it. That rule is the same on every
surface. Only where the card is shown differs. Every card is saved in the
Explore conversation and shown under the answer on the web. A Discord or Voice
answer points the asker to that conversation.

## How this is checked

The [scenario eval](/how-to/run-the-explore-scenario-eval/) runs each use case
on every surface it lists. A case that passes on the web and fails on Discord
fails the run. Surface parity is graded the same way as correctness.

## Related

- [Why Scout Voice is an Explore interface](/explanation/scout-voice-explore/)
- [Run the Explore scenario eval](/how-to/run-the-explore-scenario-eval/)
