---
title: Why Explore is the same on every surface
description: Why web Explore, /scout ask, Scout Voice and Scout Desktop share one set of tools, skills, cards and creations, and what still differs between them.
sidebar:
  order: 9
---

Explore offers the same capabilities on the web, in Discord's `/scout ask`, in
Scout Voice and in Scout Desktop. The surface changes how a question arrives
and how the answer is delivered. It never changes what Explore can do
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
cards as embeds and follow-up suggestions as buttons. The web and Scout
Desktop render both as components from the same transcript. Skills that only
shape delivery declare the surfaces they shape with `outputFor`. The skill
loader rejects `outputFor` on any skill gated by a capability, so a capability
cannot quietly become web-only again
([`skills/loader.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/skills/loader.ts)).

**How an image reaches a question.** The web composer accepts a pasted,
dropped or picked image, and `/scout ask` takes one as an attachment option.
Both store it the same way before the question is sent: the private support
bucket, under `explore/`, validated by its bytes. The question then claims it by
id, so the agent sees the same image parts wherever it was asked. Voice has no
way to attach one. Only the current question's images go to the model; earlier
ones are replayed as a marker, which keeps every turn's input bounded. The
storage contract lives in `packages/backend/src/explore/attachments/`.

**How Scout learns the asker's permissions.** A web session carries the
asker's Discord OAuth guild list. Scout Desktop acts as its owner, so it uses
the same stored OAuth grant and takes the same path. A `/scout ask` or Voice
user has no OAuth token, so Scout's bot answers instead. It checks membership,
guild ownership and the Administrator bit on the asker's roles, then reads the
same Scout grants. Every path makes the same decision and raises the same
errors. An unreachable Discord is reported as an outage, never as a missing
permission
([`guild-permission.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/trpc/guild-permission.ts),
[`creation/capability.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/explore/creation/capability.ts)).

## How Scout Desktop asks as its owner

Scout Desktop holds a device credential, not a browser session. Its owner
grants it the `explore` scope when they approve the pairing. The desktop then
reaches Explore through its own REST routes under
`/api/scout-client/v1/explore/`, never through the web's tRPC procedures. A
bearer path into tRPC would reach every procedure that trusts the session
cookie as its only credential. The desktop routes stay narrow instead, and each
one calls the same function its web procedure calls
([`scout-client/desktop/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol/packages/backend/src/scout-client/desktop)).

Starting a turn goes through the same run manager as the web, with the owner's
identity. That is what keeps the allowance honest. The per-person question
quota and the one-answer-at-a-time limit count the owner, not the surface. A
question asked on the web counts against the desktop, and an answer running on
the desktop holds the web back. The desktop adds no quota of its own. It only
bounds what a single device can hold open: a fixed number of requests a
minute, and a few concurrent answer streams. A stream has no idle timeout while
the model thinks, so a leaked or looping credential must not be able to pin
responses open.

The desktop observes a run with the same event stream the browser reads. Every
stream starts with a complete snapshot of the answer so far. A reconnect
therefore replaces state rather than appending it twice, which is what lets the
desktop drop and resume a stream freely.

A conversation started on the desktop records `desktop` as its origin. Browser
tabs keep their bundle for as long as they stay open, and they parse the origin
strictly. An origin an old bundle has never heard of would make the whole
conversation unreadable there. So a bundle that has not declared the newer
transcript version reads a desktop conversation as `web`, which it is in every
way that bundle can render. The desktop's own contract works the same way: a
client on an older contract version is told `web` too.

## Confirmations stay with the person who asked

Explore prepares a creation and never performs it. A confirmation card holds
the proposal until its owner accepts it. That rule is the same on every
surface. Only where the card is shown differs. Every card is saved in the
Explore conversation and shown under the answer on the web. A Discord, Voice or
Scout Desktop answer points the asker to that conversation.

## How this is checked

The [scenario eval](/how-to/run-the-explore-scenario-eval/) runs each use case
on every surface it lists. A case that passes on the web and fails on Discord
fails the run. Surface parity is graded the same way as correctness.

## Related

- [Why Scout Voice is an Explore interface](/explanation/scout-voice-explore/)
- [Run the Explore scenario eval](/how-to/run-the-explore-scenario-eval/)
