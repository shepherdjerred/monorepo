# Cost against shipped quality

Estimates from the last run's per-pass spend (35 units) and the cached labels of the two reference judges (1,280 tips); nothing here was run. Cost is linear in units: 2798 for a full run, 380 for a typical patch; prefix-cache reuse across the plan would take 5 to 25% off.

| Configuration                                             | Final tips per set | Both-reference-wrong share shipped | Full run | Per patch |
| --------------------------------------------------------- | ------------------ | ---------------------------------- | -------- | --------- |
| (a) as run                                                | 9.9                | 2.0%                               | $311     | $42       |
| (b) 2 fill passes                                         | 8.6                | 2.0%                               | $261     | $35       |
| (c) escalate only p(wrong) >= 0.3 plus interaction claims | 10.4               | 2.7%                               | $276     | $38       |
| (d) (b) and (c), no second look                           | 9.0                | 3.2%                               | $213     | $29       |
| (e) (d) with Haiku fill passes                            | 9.0                | 3.4%                               | $150     | $20       |

Unfiltered, a generator's tips are 7.7% both-reference-wrong (Haiku 9.0%, Sonnet 8.0%, Opus 6.2%); Sonnet medium alone as a filter left 1.9%.

How the numbers are built:

- Cost per unit: Sonnet pass 1 ($0.022), each fill pass as measured, triage scaled by the tip count, escalation and the second look by the number of tips escalated, repair and re-check by the number sent to repair or judged wrong, and $0.002 for combos under the empty-by-default prompt.
- (a) is below the $349 linear figure in the run report: that included combos at $0.012 per unit under the old prompt and the retry of the 4 units whose first answer failed ($0.004 per unit), neither of which a normal run pays.
- Share escalated, kept and repaired at each threshold is counted on the cached labels (calibration table); Decisions' p(wrong) is the same score the run used.
- Shipped both-reference-wrong: the both-wrong tips triage keeps unexamined, plus 16.2% of those in the escalated and repair buckets (Sonnet medium's measured miss rate), over the tips that survive. It assumes the repaired and re-checked tips are caught at the same rate; the pipeline's own repair step was not scored against the references. With no second look, the 12% of escalated tips left not-checkable ship as they are (interaction claims among them are still dropped, not counted here).
- Final tips per set: tips after the fill passes (10.1 after two, 11.7 after three) less the 22.0% of examined tips the run dropped.
- (e): Haiku costs a twentieth of Sonnet per token; its tips are 9.0% against Sonnet's 8.0% both-wrong before filtering in the eval, applied to the fill tips only. Haiku's fill tips per pass, and how many near-duplicates it writes, were not measured; the earlier Haiku sample wrote about five tips per side where Sonnet wrote six.
