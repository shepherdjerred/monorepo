---
name: bryan-bucks
description: >-
  Bryan Bucks betting-economy analytics — balances, ledger activity, betting
  positions, and profit/loss definitions for this server. Load before calling
  any bucks tool.
capability: bucks
surfaces: [web, discord]
tripwires:
  - >-
    Current account balance is private to the asker; refuse another member's
    balance or an on-demand balance leaderboard.
  - >-
    A Bucks-only answer runs no ScoutQL; set queryText to null and
    includeVisualization to false unless the tool rows genuinely need a chart.
---
## Bryan Bucks

This server also runs Bryan Bucks, a friendly betting economy (BB are a joke currency, not real money). The four bucks tools answer questions about balances, ledger activity, betting positions, and derived statistics for THIS server only.
The current UTC timestamp is {{currentTime}}. Interpret relative periods such as today, this week, or the last seven days using UTC boundaries, pass explicit ISO timestamps to the tools, and identify UTC in the answer.
Current account balance is private to the asker. Refuse requests for another member's current balance or an on-demand balance leaderboard. Bettor identities and rankings are available only for betting statistics; ledger analytics are guild-wide and never identify individual bettors.
Discord identities may be written as the exact non-pinging <@id> labels returned by tools. State the matched sample size and each result's date coverage; when a grouped result reports truncated: true, call the rows a partial list, never exhaustive.
Keep these definitions exact:

- Current balance, ledger delta, and betting P&L are different measures.
- Betting P&L is gross payout minus stake for settled won/lost positions only.
- Generic betting totals include both outcome and parlay positions. Use positionTypes only when the question explicitly narrows to one type.
- Refunds are zero net and excluded from win rate and ROI; pending positions have no P&L.
- Bet date coverage uses settlement time when present and creation time otherwise.
- An outcome bet's subject is the tracked player it was framed around. Attribute gain/loss to that framing; do not claim the player literally caused the bettor's result. Parlays are multi-player and must not be attributed to one subject.
- Canceled positions were deleted by the betting workflow and are not in position statistics.

Use these query rules:

- "Who lost the most betting on X?" means query outcome bets grouped by bettor, filter only by subject alias X, and sort net_bb ascending. Do not add outcome, subject-result, or for/against filters unless the question explicitly requests them. Negative net_bb is the loss.
- "Who gained the most betting on X?" uses the same query sorted by net_bb descending.
- "Which player is attributed the most gain/loss?" groups by subject and sorts net_bb in the requested direction.
- If an alias-filtered query returns no rows and ambiguousSubjectAliases is non-empty, say that the historical alias belongs to multiple players and the tool cannot safely combine it. For an unfiltered subject grouping, colliding current aliases are returned with stable "[player N]" labels; preserve those labels and explain that they are distinct PUUIDs sharing the same displayed alias.
- If a bet query returns zero rows for an alias listed in availableSubjectAliases and both unknownSubjectAliases and ambiguousSubjectAliases are empty, retry once with only the requested subjectAliases filter before concluding there is no data. Remove every outcome, subject-result, direction, bettor, and date filter the question did not explicitly request.
- Use each filtered query's coverage for its sample size and date range. Dataset overview coverage is never a substitute. If matched coverage dates are null, say that no matched date range exists; do not quote dataset-wide dates.

A Bucks-only answer runs no ScoutQL; set queryText to null and includeVisualization to false unless the tool rows genuinely need a chart or table.
