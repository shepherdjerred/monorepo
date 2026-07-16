# ScoutQL Feature Ideas

## Status

Complete

## Context

ScoutQL currently supports a bounded `SELECT` over match, prematch, teammate-group, and competition sources; grouping by player, champion, queue, or teammate group; four filters; 22 metrics; ordering and limits; five render kinds; Monaco assistance; live preview; AI editing; schedules; and run history. The report lake already contains more Riot fields than ScoutQL exposes.

## Ideas

1. Expose economy metrics: `gold_spent`, unspent gold, and gold spent per minute.
2. Add efficiency metrics: damage per gold and champion damage per minute.
3. Expose objective damage and turret damage.
4. Expose objective takedowns: turrets, inhibitors, dragons, and Barons.
5. Add healing and teammate-healing metrics.
6. Add damage-mitigated and effective-frontline metrics.
7. Expand vision metrics with wards killed, control wards bought, and detector wards placed.
8. Expose time dead, longest life, and CC time.
9. Split multikills into doubles, triples, quadras, pentas, and largest multikill.
10. Add first-blood and killing-spree metrics.
11. Add Arena placement, average placement, top-two rate, and win rate.
12. Add `GROUP BY position`, `lane`, and `role`.
13. Support compound dimensions such as `GROUP BY player, champion` and `player, queue`.
14. Add player filters by alias or stable player id.
15. Add champion-name filters and champion lists instead of numeric id only.
16. Add outcome filters for wins, losses, surrenders, and early surrenders.
17. Add position, role, game mode, map, and patch filters.
18. Add game-duration ranges and named duration buckets.
19. Add calendar grouping by day, week, month, and day of week.
20. Add relative-period comparisons such as current window versus previous window.
21. Add per-game and per-minute metric modifiers without defining every variant as a separate metric.
22. Support metric aliases for human-friendly output headers.
23. Add `HAVING` for post-aggregation filtering beyond the special `games >= N` case.
24. Add conditional aggregates, such as win rate only on a selected champion or role.
25. Add distinct counts for champions played, teammates, queues, and active days.
26. Add median, percentile, standard deviation, and consistency metrics.
27. Add bounded formulas for composite scores and user-defined derived metrics.
28. Add multi-series and stacked charts, with multiple `y` channels and optional color grouping.
29. Add scatter, heatmap, pie/donut, and KPI-card render kinds.
30. Add result-triggered delivery, such as posting only when a threshold is crossed or the leader changes.

## Usefulness Ranking

Ranked by how many valuable report questions the feature unlocks, independent of implementation cost:

1. Compound dimensions (`player, champion`, `player, queue`).
2. Per-game and per-minute metric modifiers.
3. Position, lane, and role grouping.
4. Player filters by alias or stable id.
5. Champion-name and champion-list filters.
6. Outcome and surrender filters.
7. Current-window versus previous-window comparisons.
8. Position, role, mode, map, and patch filters.
9. Objective and turret damage.
10. Objective takedowns.
11. Expanded vision metrics.
12. Healing and teammate-healing metrics.
13. Distinct counts for champions, teammates, queues, and active days.
14. `HAVING` clauses.
15. Conditional aggregates.
16. Median, percentile, standard deviation, and consistency metrics.
17. Economy metrics.
18. Damage-per-gold and damage-per-minute efficiency metrics.
19. Arena placement metrics.
20. Game-duration ranges and buckets.
21. Calendar grouping.
22. Multi-series and stacked charts.
23. Result-triggered delivery.
24. Metric aliases.
25. Damage mitigated and frontline metrics.
26. Time-dead, longest-life, and CC metrics.
27. First-blood and killing-spree metrics.
28. Granular multikill metrics.
29. Bounded custom formulas and composite scores.
30. Additional scatter, heatmap, donut, and KPI renderers.

## Session Log — 2026-07-12

### Done

- Inspected the current ScoutQL schema, registry, editor, preview, DuckDB compiler, aggregation layer, render model, and report-lake schema.
- Identified 30 additions that do not duplicate the current language surface.
- Ranked the additions by usefulness and identified a separate high-leverage implementation order.

### Remaining

- Select the first implementation tranche and turn it into a scoped implementation plan.

### Caveats

- Ideas 1-11 mostly reuse already-ingested lake columns; later language and visualization ideas require progressively larger parser, compiler, editor, and renderer changes.
