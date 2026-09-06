---
title: Run a duel or tournament
description: Configure a direct 1v1 or 2v2 challenge, organize an asynchronous event, and review results safely.
sidebar:
  order: 8
---

Scout uses one duel system for direct challenges, rolling records, and
structured 1v1 or 2v2 events. It tracks friendly competition only: there are no
entry fees, prizes, bets, or Bryan Bucks markets.

## Confirm the feature is available

Duel access is controlled per Scout environment and server. Classic objective
rules and events below 20 participants remain unavailable in beta and
production until Scout records Riot's written approval for them.

## Create a direct challenge

Open `/app/duels/<server id>` and choose 1v1 or 2v2. Select exact guild Players
and freeze the Riot account each person will use. A 2v2 competitor is the exact
pair you assign; an optional team name is cosmetic.

Choose at least one winning condition:

- kill target from 1 to 10,
- lane-CS target from 10 to 500, or
- first turret.

For 1v1, kill and lane-CS totals belong to one player. For 2v2, Scout sums them
for the assigned pair. Jungle CS does not count.

Every invited participant must accept the current custom-match disclosure. An
organizer cannot accept for them or make their results member-visible without
consent.

## Create a structured event

Choose an event format:

- single elimination,
- double elimination with a grand-final reset, or
- single round robin.

Elimination events accept up to 64 entrants. Round robin accepts up to 16.
Registration may be open or invitation-only. Seed entrants manually, randomly,
or from the displayed rolling record; deterministic byes keep the bracket
stable.

Select best-of-1, best-of-3, or best-of-5 for the event. You can override the
best-of value for individual rounds. Set each asynchronous match window from 24
hours to 14 days; the default is seven days.

## Ready up and play

Scout provisions a Tournament code only after every assigned player marks
ready. Authorized participants read the code in the web app. Discord receives
only a readiness or status message and never contains the code.

Scout evaluates the earliest configured objective. Kill and turret times come
from exact timeline events; lane CS comes from participant frames. Complete
timeline evidence is required.

## Resolve reviews and overdue series

Scout sends these cases to organizer review instead of guessing:

- simultaneous or indeterminate objective crossings,
- unexpected players or split 2v2 pairs,
- missing timeline evidence, or
- a completed game in which no configured objective occurred.

An expired window marks the series overdue and mentions participants, but never
awards a result. An organizer must record a reason and choose replay,
no-contest, or advancement. A no-show advancement does not count as a played
game or alter rolling records.

Every verified played game updates individual, pair, and head-to-head history.
Event series also update series wins and losses. Win-rate rankings require at
least five played games; Scout does not calculate MMR or Elo.

## Related

- [Competitive progression reference](/docs/reference/competitive-progression/)
- [Why competitive progress is deterministic](/docs/explanation/deterministic-competitive-progression/)
