---
title: Jerred's Systems Wiki
description: How the monorepo, the homelab, and the automation around them actually work — organised by what you need right now.
template: splash
hero:
  title: Understand the system.
  tagline: One repo, two Talos nodes, and a lot of automation that runs without anyone watching. This is the map.
  actions:
    - text: Why Temporal
      link: /explanation/temporal/overview/
      icon: open-book
    - text: Run the PR fleet
      link: /how-to/run-the-pr-fleet/
      variant: minimal
      icon: rocket
---

## Start here

New to a corner of this? The [tutorial](/tutorials/first-agent-task/) is a
worked lesson — follow it start to finish and you will have something running.

- **[Your first agent task](/tutorials/first-agent-task/)** — schedule a
  report-only agent run, watch it execute, and read the email it sends.

## Solve a specific problem

The [how-to guides](/how-to/run-the-pr-fleet/) assume you know what you want and
get you there: [running the PR fleet](/how-to/run-the-pr-fleet/),
[cutting a homelab release](/how-to/cut-a-homelab-release/),
[working out why a schedule did not fire](/how-to/pause-or-debug-a-schedule/),
or [wiring an iOS Shortcut to a sleep routine](/how-to/build-the-sleep-shortcut/).

## Look something up

The [reference](/reference/temporal-workflows/) is the facts, in tables: the
[workflow inventory](/reference/temporal-workflows/), the
[schedule mechanics](/reference/temporal-schedules/), the
[agent task contract](/reference/agent-task-input/), the
[PR fleet CLI](/reference/pr-fleet-cli/), and the
[home automation routines](/reference/home-automation-routines/).

## Understand how it fits together

The [concept guides](/explanation/monorepo/) cover
[why everything is one repo](/explanation/monorepo/),
[the two-node homelab](/explanation/homelab/overview/),
[what durability buys](/explanation/temporal/overview/), and the boundaries
worth being honest about —
[what the PR fleet may never do](/explanation/pr-fleet-authority-boundary/) and
[what "report-only" actually protects](/explanation/temporal/agent-task-boundary/).

Provenance for all of it lives in [working material](/working/), and
[how this wiki works](/explanation/how-this-wiki-works/) explains the split.
