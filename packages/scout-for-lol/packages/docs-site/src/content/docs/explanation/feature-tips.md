---
title: Why Scout sometimes suggests a feature
description: How the occasional tip line on a Scout message is chosen, and why you only ever see it once.
sidebar:
  order: 20
---

Scout has more features than any one server uses. Competitions, scheduled
reports, queue filters, the Hall of Fame, duels, dares, custom nights,
tournament lobbies — most servers find two or three and never learn the rest
exist. Tips are how Scout mentions the others without turning into an
advertisement.

## What a tip looks like

A tip is a single line in the footer of a message Scout was already sending —
a post-match report, a pre-match alert, or a Bryan Bucks settlement DM. It is
never its own message, so it cannot add to the traffic in your channel.

If a message has no embed, or its footer already says something (a competition
ID, a duel series ID), Scout leaves that message alone rather than displacing
its content.

## Which tip you see

A tip has to clear two bars before it is a candidate:

- **Available.** The feature is actually enabled for your server. Scout never
  advertises something you cannot use.
- **Unused.** Your server has not used the feature yet. Once you have created a
  competition, the competitions tip stops being a candidate — Scout checks the
  competitions you have, not a counter it keeps.

Whichever candidate is most broadly useful comes first.

## How often

Two independent limits, and both must allow it:

- A **cooldown** — a minimum time between tips to the same audience. A busy
  server does not get more tips than a quiet one, because the pacing is
  time-based rather than volume-based.
- A **percentage** — only a fraction of otherwise-eligible messages carry one.

A settlement DM that already carries the `/bb notifications` hint never also
carries a tip. One aside per message is the limit.

## Seeing one twice

You should not. Scout records each tip it delivers and never offers the same
one to the same audience again, so the list only ever shrinks. A server that
has found everything stops seeing tips entirely.

That record is written before the message goes out, not after, and the database
refuses a second copy of it. Two messages sent at the same moment therefore
cannot pick the same tip — one of them claims it and the other simply carries
no tip. If the send then fails, the claim is handed back and the tip stays
available.

Channel tips and DM tips are paced separately, so a direct message to one
member does not use up the channel's tip.
