---
title: Review AI staff decisions
description: Work the escalation queue, assemble ticket cases, and overturn or dismiss agent decisions.
sidebar:
  order: 43
---

This guide shows how to review what the AI staff did, do, or would have done,
and how to correct it. Command syntax is in the
[agent reference](/reference/the-storm-agent/).

## 1. Open the queue

Run `/escalations`. The queue has two sections: escalations the agent handed
off (chat cases it wouldn't judge alone, triage below confidence, and SLA
breaches from the sweep) and spot-checks sampled from everything else at
`reviewSamplePercent`. Rows name the decision id, player, offense, ticket
link, and model; sampled rows carry a `sampled` marker.

Rows leave the queue once reviewed, whether overturned or endorsed. There is
no separate dismiss action.

## 2. Assemble the case

Run `/agent case <ticket-id>` for a queue row with a ticket link. The case
shows the ticket and its triage, the reporter's standing and moderation
history, the agent's trail on the ticket, and the reporter's recent agent
decisions as precedents.

For chat rows with no ticket, `/agent decisions <player>` shows the player's
recent rows instead.

## 3. Act through the normal commands

Handle the underlying situation first: warn, mute, kick, or ban through the
usual commands, or work the ticket with `/ticket claim`, `/ticket resolve`,
and comments. For a known question, `/agent faq <ticket-id>` posts the
catalog's answer. The agent's row stays as the record either way.

## 4. Endorse or overturn the row

When the agent called it right, run `/agent endorse <decision-id>`. The row
gains an `endorsed` marker and clears from review with nothing undone and no
comment written.

When it called it wrong, run `/agent overturn <decision-id>`:

- A mute row lifts the mute when one is active.
- An escalation row dismisses it from the queue; nothing else executes.
- Warn, kick, allow, and tempban rows mark as overturned with no reversal.

The row gains an `overturned` marker, overturned mutes stop counting toward
ladder strikes, and ticket-linked rows get a staff-only correction comment.
Overturning or endorsing twice reports who did it first. An overturned row
cannot be endorsed.

:::caution
`/agent overturn` and `/agent endorse` need a player sender. Console and RCON
cannot record a reviewer UUID.
:::

## 5. Spot-check shadow rows

In shadow mode the same queue shows would-have-dones. `/agent decisions`
without a player lists the newest rows of every kind; the `shadow` marker
distinguishes rehearsal from action. Disagreement with a shadow row is still
worth an overturn: the mark is what feeds ladder and prompt review.

## Related

- [The Storm agent reference](/reference/the-storm-agent/) for commands and permissions
- [The Storm AI staff](/explanation/the-storm-ai-staff/) for why the system looks this way
