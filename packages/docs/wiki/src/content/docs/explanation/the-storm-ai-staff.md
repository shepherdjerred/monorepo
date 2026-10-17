---
title: The Storm AI staff
description: Why the game judges in-plugin, the brain answers statelessly, and the sweep runs on the game scheduler instead of Temporal.
---

The Storm prevents abusive publication in the game and keeps private evidence for human review.
Its Safety module owns admission; the agent works tickets and exposes the review queue.
The stateless brain supplies content judgments without owning punishment or player history.

```mermaid
flowchart TB
accTitle: Content admission flow
accDescr: Safety saves each attempt, obtains a stateless content judgment, and either publishes it or holds it for review. Both outcomes stay in private evidence.
  Content([Player content]) --> Save[Safety saves attempt]
  Save --> Brain[Brain screens content]
  Brain --> Verdict{Safety verdict}
  Verdict -->|allow| Publication([Publish])
  Verdict -->|block or review| Hold([Withhold])
  Publication --> Evidence[(Private evidence)]
  Hold --> Evidence
  Evidence --> Review[Staff reviews reference]
```

## Judgments cross the wire; state does not

The plugin assembles each case from its own SQLite store: the reporter's
history, prior triage, recent chat. It POSTs the case to the brain and gets
back a verdict with the model and cost attached. The brain keeps no session,
no queue, and no memory of the player.

This split exists because the game server hibernates at zero replicas when
empty. Anything the brain stored would be unreachable half the time, and
anything that called into the game would fail whenever nobody is online.
Server-initiated HTTPS is the only shape that survives hibernation, so the
brain never calls back.

The plugin side lives in `packages/the-storm/plugin/modules/agent`; the service
contract lives in `packages/storm-brain/src/schemas.ts`.

## Ticket shadow mode bounds rollout

Ticket decisions record whether the agent was watching or acting. Shadow rows
retain proposed triage and sweep actions without applying them. Reviewer agreement
on sampled rows determines whether those flows are ready to act.

The sweep records would-escalate rows
instead of moving tickets. Triage attaches nothing. The queue, the case view,
and Discord all render shadow rows, so reviewers calibrate on the same
surface they will operate later.

## Prevention limits punishment

A publication can be withheld without punishing its author. Ambiguity, a provider
outage and an actual offense have different evidence and different consequences.
Only clear abuse receives a short automatic mute; bans remain human decisions.
The [agent reference](/reference/the-storm-agent/) defines the exact policy.

Every surface uses the same admission owner so a player cannot move abuse from chat
to signs, books or message commands. A link is judged in its conversation rather
than treated as advertising by itself. Until screening is enabled, unscreened
Global chat retains the existing prefilters and ladder. A screened publication
never runs through that legacy enforcement again.

Private evidence preserves allowed attempts as well as refusals, enabling later analysis
without exposing DMs through console logs or incident summaries. Evidence references
let staff find the original context without copying it into public surfaces.
The implementation lives in the [Storm modules](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm/plugin/modules).

Unknown offense and priority ids fail closed. The flows drop verdicts that
name offenses outside the ladder list rather than guessing, and low
confidence resolves to escalation or silence depending on the flow.

## The sweep runs in-plugin because Temporal cannot reach the game

Stale tickets need re-driving and SLA breaches need escalation. That work is
periodic, and recurring homelab work belongs in Temporal — except when its
state and actuators hibernate with the game server. A Temporal workflow
cannot query tickets or mute players at zero replicas, so the sweep runs on
the plugin's scheduler: a boot sweep for crash recovery plus a configured
interval while awake.

The sweep core is still a pure function over ticket snapshots, so the policy
ports directly into a Temporal activity if ticket state ever moves
out-of-process. Until then, cadence lives in `agent.yml`, every sweep action
lands in the decision log, and quiet sweeps stay out of the logs.

## Known answers never spend a model call

Some tickets are asked every week: the starter kit, the rules, how to report
grief. Those answers live in a catalog in `agent.yml`, matched by keyword
against new tickets without touching the brain. A known question answered
deterministically is cheaper, faster, and exactly reproducible.

Repeat askers get the reply cut once two prior askings are still
remembered, with each asking forgotten after one half-life so last season's
questions never cut. Every answer signs its entry, so a sweep redrive never
answers twice, and staff can force any entry onto any ticket with
`/agent faq`.

## The greeting is staff voice, not a teleport

Essentials already handles arrival mechanics: spawn, the starter kit, the
one-line welcome. The agent's onboarding is the staff voice on top — starter
tips and where to read more — landing a few seconds after joining so it never
buries the arrival messages. Only players the server has never seen are
greeted, so restarts and reinstalls stay quiet.

## Anomaly alerts watch the brain, not the game

Cost and latency anomalies surface through Prometheus, not the plugin. The
brain already exposes request, cost, token, and duration metrics, and a
`PrometheusRule` watches for cost spikes, degraded p95 latency, request
errors, rejected callers, and a down scrape target. They route to the alert
dashboard like every other homelab alert. The plugin stays out of it: it
cannot distinguish its own quiet hours from a brain outage, and metrics can.

## Rows carry their server

Every agent ticket and decision row names its server, and those stores read only their
own server's rows, and Discord ticket posts carry the server in brackets.
Today each server keeps its own SQLite file, so the filter is defense in
depth; the labels are the point. Shared surfaces — one Discord channel, one
brain, one day possibly one database — never mix servers up. Private evidence exports
also record their explicit bridge target and time bounds in a manifest.

## Strictness is skew detection

Every boundary parses strictly: StrictYaml rejects unknown config keys, the
brain's Zod schemas reject unknown JSON keys, and the plugin's response
parser does the same. Plugin and brain deploy independently, so a field added
on one side must fail loudly on the other instead of silently changing
meaning. The 400s and `BrainException`s are the version-skew alarm.
