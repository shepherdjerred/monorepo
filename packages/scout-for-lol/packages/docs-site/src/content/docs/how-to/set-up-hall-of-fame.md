---
title: Set up a Hall of Fame
description: Choose the queues and records your server tracks, build the first baseline, and understand record-break announcements.
sidebar:
  order: 6
---

The Hall of Fame keeps your server's best single-game performances. Records are
separated by comparable queue family, so an ARAM score never competes with a
ranked Summoner's Rift score.

## Open Hall settings

Open your server workspace, then choose **Hall of Fame**. You need the existing
server configuration permission to change these settings.

Choose a Discord channel for future record-break announcements. The public Hall
at `/app/halls/<server id>` is available to current members of the server.

## Choose queue families

Scout selects these families for a new Hall:

- Ranked Summoner's Rift
- Unranked Summoner's Rift
- ARAM
- Arena

Enable or disable any family. Each family has its own copy of every record, and
you can disable an individual record inside a family.

Custom games and Scout duel matches never enter the Hall. Those games require
player-specific disclosure and consent, which a server-wide record board cannot
assume.

## Build the baseline

Save the settings, then choose **Build baseline**. Each enabled family and
record reports one of three states:

- **Building** — Scout is evaluating eligible history.
- **Ready** — the record has a current value and holder, or Scout found no
  eligible performance yet.
- **Failed** — Scout could not finish that cell; start the baseline again after
  the underlying problem is fixed.

Scout uses completed, non-remake matches from after each account began tracking
in this server. Only currently tracked players qualify.

The baseline is silent. It establishes the records that future matches must
beat; it does not announce old performances as if they just happened.

## Change the Hall later

Enabling a new family or record starts a fresh baseline for that cell. Re-
enabling one does the same, so games played while it was disabled do not create
a burst of announcements.

Removing a player or Riot account silently recomputes affected records from the
remaining eligible history. Scout does not announce that administrative change
as a new record.

## Read record breaks

Equal performances share a record. A new result must be strictly greater than
the current value to count as a break.

When one match breaks several records, Scout combines them into one message in
the Hall channel. Retried processing cannot announce the same break twice.

## Related

- [Competitive progression reference](/docs/reference/competitive-progression/)
- [Why competitive progress is deterministic](/docs/explanation/deterministic-competitive-progression/)
