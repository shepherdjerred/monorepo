---
title: Why Scout is web-first
description: Why configuration and conversation history live in the browser while Discord keeps a small in-the-moment surface.
sidebar:
  order: 4
---

Scout used to be configured entirely through Discord. There were command trees
for subscriptions, players, accounts, competitions, reports, and permissions —
dozens of subcommands. Today there are seven global commands, one allowlisted
Explore command, and everything else lives in the browser.

This page is about why, including the parts that got worse.

## What slash commands are good at

Discord commands have a real advantage: zero context switch. You are already in
the channel, talking to the people you play with, and tracking a player is one
line. That is why `/track` still exists — the fastest possible path from "we
should track this person" to a working subscription, with no browser, no sign-in,
and no navigation. `/scout ask` follows the same principle for a different
moment: ask one question while discussing a game, see the answer privately, and
decide whether it belongs in the channel.

That advantage is specific to short, single-purpose actions. It does not survive
contact with complexity.

## Where it breaks down

A slash command is a flat list of typed options with no memory of what came
before. That constraint is fine for `/track`, and increasingly bad as the
operation grows:

- **No progressive disclosure.** Everything a command might need is in one
  signature. A subscription with filters, a queue allow-list, and a channel is a
  long line of options that has to be typed correctly the first time.
- **No good way to show state.** Discord can render a list, but it cannot render
  a table you can sort, filter, and edit in place. "What is currently
  configured?" is the question people ask most, and it is the one chat answers
  worst.
- **Validation arrives late.** You discover a mistake after submitting, and you
  fix it by retyping the whole command.
- **Discoverability is a memory test.** With dozens of subcommands, using Scout
  well meant remembering that they existed.

None of these are Discord being bad. They are what a command line is, and a
command line is the wrong shape for editing structured configuration.

## What the browser is actually better at

Forms with validation as you type, tables that show every subscription at once,
a query editor with completion and inline errors, a preview of what a report
will produce before you save it, and an interface that can display a permission
matrix without inventing a syntax for it.

A dashboard also lets Scout add capability without adding command vocabulary.
Creating and maintaining saved reports or ScoutQL is still the wrong shape for a
slash command; as a page with an editor and a preview, it is ordinary. Explore
keeps one narrow Discord entry point because natural-language input is already
one field. Its conversation history, follow-ups, branches, traces, and sharing
remain in the web UI.

## What this costs

It is worth being honest about the losses.

**Setup now requires leaving Discord.** For a server that only ever wanted "post
this person's ranked games here", the old flow was better, and no amount of
dashboard polish beats one line in chat. `/track` and `/list` exist to preserve
exactly that case.

**There is a sign-in step.** OAuth is friction, and some people bounce off it.

**Configuration is less visible to the server.** A command run in chat is
implicitly public — everyone saw it happen. Dashboard changes are not, which is
part of why the [audit log](/docs/reference/dashboard/) exists.

**Muscle memory was broken.** Servers that had used the old command tree for
years had to relearn where things live. That is a genuine cost, paid once, and
it was the main argument against the change.

## Why the split lands where it does

The rule is roughly: **Discord for things you do in the moment, the browser for
things you decide.**

Tracking a player, checking what is tracked, and asking one data question are
momentary — you do them while talking, so they have lightweight commands.
Choosing which queues route to which channel, who has access, what a weekly
report measures, or how an Explore conversation continues are longer-lived
decisions. Those stay in the browser.

The publication boundary is explicit. `/scout ask` starts private, saves the
same conversation the web app would, and posts nothing until the asker presses
**Post publicly**. That posts a frozen copy, not a live query and not an
owner-only link.

Notifications, of course, remain entirely in Discord. That was never in
question: Discord is where the server experiences Scout, and the dashboard is
only where it is configured.

## Related

- [Discord commands](/docs/reference/discord-commands/)
- [Dashboard reference](/docs/reference/dashboard/)
