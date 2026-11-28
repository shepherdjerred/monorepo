---
name: incident-response
description: Respond to a shared-system incident or maintenance window through Hub Incidents and `toolkit incident`. Use when main is red, Delivery is stuck or refusing, the cluster, observability, or another shared system is broken and blocks you, when you caused such a breakage, when you were spawned as an incident commander, or when declaring planned maintenance.
---

# Incident response

Hub Incidents (`https://hub.tailnet-1a49.ts.net/incidents`, `toolkit incident`)
holds one record per shared-system breakage or maintenance window, with one
commander. It replaces Forum notices for red main, stuck Delivery, and shared
outages. Resource leases, private qualification locks, and workstream
announcements stay Forum notices (`tracker-work-management`).

An incident records and coordinates; it grants no authority. Recovery still
follows the owning skill: `monorepo-delivery` for main, `delivery-recovery` for
Delivery, `homelab-operations` for the cluster and services.

## Blocked by a shared system

```bash
toolkit incident check [--system main-ci|delivery|cluster|...] --json
```

- **Exit 11 — you likely caused it** (your session, branch, or PR is the
  suspect) and nobody commands it: `toolkit incident take INC-N`, then fix it as
  commander. Taking over what you caused is mandatory.
- **Exit 10 — an incident is open:** `toolkit incident wait INC-N` (or
  `--system X`). Hold it as one blocking command (`run_in_background` in Claude
  Code); never poll. It joins you as affected and exits 0 when the incident
  resolves. If nobody takes command within the takeover grace, exactly one
  waiter wins the server's dispatch lease and spawns a commander session in a
  new worktree; everyone else keeps waiting. Do not race it with `take --force`.
- **Exit 0 — nothing open** but the system is broken for you: declare it with
  an observable exit condition, then wait on it or take it.

```bash
toolkit incident declare --system delivery --severity sev2 \
  --title "<what is broken>" --exit-condition "<observable recovery>" \
  --link pipeline=<N> [--take]
```

A duplicate declaration exits 13 and names the open incident; wait on that one.
Keep doing unblocked work while you wait. Incidents opened by alerts or by the
main-ci signal start without a commander and resolve themselves when every
signal clears and nobody ever took command.

## Commanding an incident

You command an incident you declared with `--take`, took with `take`, or were
spawned for. A spawned session first redeems its dispatch handle, exactly as
its first message says: `toolkit incident claim INC-N --dispatch-handle <H>`.

1. Read the record: `toolkit incident view INC-N --json` (signals, suspect,
   links, affected agents, timeline). Check the Forum for related threads.
2. Move status as facts change: `identified` once the cause is known,
   `mitigating` while the fix lands, `monitoring` once it is in and you are
   checking the exit condition. Use `--expected-revision` from your last read.
3. Link evidence as you produce it: PRs, pipelines, Delivery deployments,
   Tracker issues (`toolkit incident link INC-N --kind pr --ref 5150`).
4. Post a milestone with `toolkit incident update` whenever something changes
   that a blocked agent would want to know. Affected agents read the timeline.
5. Resolve only with evidence that the exit condition holds (exact-head CI,
   Delivery state, live probe): `toolkit incident resolve INC-N
--expected-revision <N> --note "<evidence>"`. Never wait a fixed soak period.
6. File follow-ups as `AI` issues and link them before resolving.

If you cannot finish, `toolkit incident handoff INC-N --to <actor-key>` or
`release` it with a note so a waiter can take over; never leave it owned and
idle.

## Maintenance windows

Declare planned disruption (Talos or Kubernetes upgrades, paused CI, database
maintenance) as `--kind maintenance --start <ISO> --end <ISO>` with the systems
it affects. Move it `in_progress` when it starts, `verifying` while checking,
and `completed` or `canceled` with evidence. Maintenance is never taken over or
dispatched automatically.

## Exit codes

`check`/`wait`: 0 nothing open or resolved, 10 open, 11 you likely caused it,
12 you are commander. 13 duplicate declaration, 14 stale revision, 15
`take`/`claim` refused, 6 timeout, 1 server or spawn failure. Full reference:
`packages/toolkit/README.md` ("Incidents") and `packages/incidents/README.md`.
