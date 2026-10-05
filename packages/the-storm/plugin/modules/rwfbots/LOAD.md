# rwfbots load profile

Measured with `bun run test:load` (`tests/load/rwf-load.e2e.test.ts`) on
2026-10-04: one human joins, the countdown fills with bots and
`/rwf admin loadtest` tops it up to N, and the live match is sampled for
150 s after a 20 s settle. A match that ends early is re-armed until the phase
has its full time. The 0-bot row is the baseline: the same server with a human
online and no match. The container has an 8G heap and a 10g limit; the CPU
cap is 4 (the production request at the time) or 6
(`STORM_E2E_LOAD_CPUS=6`). The raw JSON is written under
`packages/the-storm/.cache/e2e/load/`.

The host was a 12-core workstation that other agents were also using. The host
load column is the mean one-minute load average during each phase, so read
any run with load well above 12 as contended. Each CPU cap was run twice. The
first 6-CPU run's baseline and 20-bot phase ran at host load 37, so it was
repeated once.

## Columns

- **MSPT p95**: the mean of spark's 10 s tick-duration p95 over the phase.
  **Added p95** subtracts the run's own baseline. **Worst 10 s** is the
  phase's highest 10 s p95, and **max** is the single slowest tick.
- **Think p95**: the slowest think-job p95 (of the last 64 jobs) seen in any
  10 s window. A window whose think p95 exceeds one tick (50 ms) counts as an
  **overrun**.
- **Board lag**: the server tick minus the newest published board's snapshot
  tick, sampled once a window. It is how far the think loop trails the game,
  from snapshot to published decision. This is the plan's staleness bar: the
  test judges its p95 over a phase's windows against 3 ticks (for these runs
  the p95 equals the max shown).
- **Decision age p95**: `/rwfbots debug`'s "staleness": the p95 age, in ticks,
  of the decision each bot follows (`tick - decision.snapshotTick`). Bots
  re-decide every `think.tacticsEveryTicks` (5, so 4 Hz), so this is about 5
  by design. It is reported but not judged.
- **Deferred**: bots the last think job left for the next one because the
  line-of-sight ray budget (`losRayBudgetPerThink: 600`) ran out.
- **Alive**: the mean count of living bots in the samples; bots die during
  the match, so it is below N.

## Results

4 CPUs, run 1 (board lag not yet measured):

| Bots | Matches | Alive | MSPT avg | MSPT p95 | Added p95 | Worst 10 s |  Max | Think p95 ms | Overruns | Deferred | Sections p95 ms | Decision age p95 | Governor | Host load |
| ---: | ------: | ----: | -------: | -------: | --------: | ---------: | ---: | -----------: | -------: | -------: | --------------: | ---------------: | -------: | --------: |
|    0 |       – |     – |      4.0 |      6.8 |         – |       10.4 | 65.1 |            – |        – |        – |               – |                – |        0 |      15.3 |
|   20 |       3 |   9.0 |      5.1 |      7.5 |       0.7 |        9.1 | 16.5 |         1.36 |        0 |        0 |            1.54 |                5 |        0 |      10.0 |
|   50 |       2 |  34.1 |      5.6 |      8.4 |       1.6 |       10.1 | 48.3 |         2.33 |        0 |       28 |            1.89 |                5 |        0 |      11.7 |
|  100 |       2 |  90.3 |      8.4 |     10.6 |   **3.8** |       13.0 | 96.0 |         3.27 |        0 |       87 |            3.70 |                5 |        0 |      17.1 |

4 CPUs, run 2:

| Bots | Matches | Alive | MSPT avg | MSPT p95 | Added p95 | Worst 10 s |  Max | Think p95 ms | Overruns | Deferred | Sections p95 ms | Decision age p95 | Board lag | Governor | Host load |
| ---: | ------: | ----: | -------: | -------: | --------: | ---------: | ---: | -----------: | -------: | -------: | --------------: | ---------------: | --------: | -------: | --------: |
|    0 |       – |     – |      3.9 |      6.2 |         – |        8.9 | 32.9 |            – |        – |        – |               – |                – |         – |        0 |       7.6 |
|   20 |       2 |  10.2 |      5.1 |      8.2 |       2.0 |       10.0 | 47.3 |         1.81 |        0 |        0 |            2.44 |                5 |         0 |        0 |       6.2 |
|   50 |       3 |  34.8 |      7.2 |     11.0 |       4.8 |       13.7 | 36.8 |         2.75 |        0 |       28 |            2.61 |                5 |         0 |        0 |      12.5 |
|  100 |       3 |  90.3 |      7.9 |     12.3 |   **6.1** |       17.0 | 76.1 |         4.35 |        0 |       86 |            2.97 |                5 |         0 |        0 |       7.0 |

6 CPUs, run 1 (contended: host load 37 during the baseline and 20 bots):

| Bots | Matches | Alive | MSPT avg | MSPT p95 | Added p95 | Worst 10 s |  Max | Think p95 ms | Overruns | Deferred | Sections p95 ms | Decision age p95 | Board lag | Governor | Host load |
| ---: | ------: | ----: | -------: | -------: | --------: | ---------: | ---: | -----------: | -------: | -------: | --------------: | ---------------: | --------: | -------: | --------: |
|    0 |       – |     – |      6.2 |     10.1 |         – |       13.7 | 95.7 |            – |        – |        – |               – |                – |         – |        0 |      36.7 |
|   20 |       4 |  10.8 |      7.2 |     10.4 |       0.3 |       15.7 | 46.3 |         2.04 |        0 |        0 |            2.29 |                5 |         0 |        0 |      37.4 |
|   50 |       2 |  30.6 |      6.9 |      9.2 |      -0.9 |       11.1 | 46.2 |         3.40 |        0 |       31 |            2.16 |                5 |         0 |        0 |      19.3 |
|  100 |       3 |  92.1 |      9.7 |     13.4 |       3.3 |       18.8 | 54.5 |         6.11 |        0 |       87 |            4.93 |                5 |         0 |        0 |      19.1 |

6 CPUs, run 2 (the repeat):

| Bots | Matches | Alive | MSPT avg | MSPT p95 | Added p95 | Worst 10 s |  Max | Think p95 ms | Overruns | Deferred | Sections p95 ms | Decision age p95 | Board lag | Governor | Host load |
| ---: | ------: | ----: | -------: | -------: | --------: | ---------: | ---: | -----------: | -------: | -------: | --------------: | ---------------: | --------: | -------: | --------: |
|    0 |       – |     – |      3.9 |      5.9 |         – |        8.4 | 56.0 |            – |        – |        – |               – |                – |         – |        0 |      11.7 |
|   20 |       3 |  10.8 |      5.2 |      8.3 |       2.4 |        9.6 | 52.5 |         1.10 |        0 |        0 |            1.66 |                5 |         0 |        0 |       8.0 |
|   50 |       2 |  34.4 |      7.9 |     11.2 |       5.3 |       14.3 | 58.0 |         2.99 |        0 |       25 |            2.20 |                5 |         1 |        0 |       8.7 |
|  100 |       3 |  89.8 |      9.6 |     14.2 |   **8.3** |       19.4 | 68.1 |         8.66 |        0 |       87 |            6.40 |                5 |         1 |        0 |      11.7 |

spark's process CPU stayed between 2.4% and 6.3% in every phase. That is at
most 0.76 of a core even if spark measures against all 12 host cores.

## Against the plan's bars

The bars live in `tests/load/load-bars.ts`, and the test asserts each one.
`bun tests/load/load-bars.ts <rwf-load-*.json>` re-judges a recorded run
without a server. Judged that way, 4 CPUs run 2 and the contended 6-CPU run 1
pass every bar, and 6 CPUs run 2 fails only the added p95 (8.3 ms). 4 CPUs
run 1 predates the board-lag sample, and the script refuses its JSON.

| Bar                                            | Verdict                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Added p95 MSPT ≤ 8 ms at 100 bots              | **Pass on 4 CPUs**, the recommended and tested shape: 3.8 and 6.1 ms. Marginal on 6 CPUs: 3.3 ms when contended, 8.3 ms (a fail) in the repeat. |
| Staleness (snapshot to decision) p95 ≤ 3 ticks | **Pass**: board lag p95 0 to 1 tick in every phase of every run that measured it.                                                               |
| No worker overruns at governor 0               | **Pass**: the governor stayed at level 0 in every phase, and no window had a think p95 over 50 ms (worst 8.66 ms).                              |

The decision age the bots report is 5 ticks in every phase at both caps. That
is the 4 Hz tactics cadence, not load, and it stays below
`maxDecisionAgeTicks` (40), past which a decision degrades.

The 8.3 ms 6-CPU result is not a capacity limit. The tick runs on one main
thread, so two more cores do not shorten it. The difference between runs is
host noise of the same size as the 4-CPU spread (3.8 against 6.1 ms).

## What this sets

- **CPU**: 6 CPUs did not beat 4. The added and absolute p95 at 100 bots were
  no lower, because the tick runs on one main thread and the think pool is
  light (think p95 ≤ 8.7 ms per job). The bot load added at most about 0.8 of
  a core. The `minecraft-tsmc` CPU request goes from 4 to 3: the 2 cores
  survival requested before rwf, plus about one core for 100 bots. The limit
  stays unset so ticks may burst.
- **Memory**: not measured here (no heap or RSS sampling). The 8Gi request,
  10Gi limit and 8G heap stay as they are.
- **maxCombatants**: stays at 100. 101 combatants (one human and 100 bots)
  held governor level 0 and met the added-p95 bar on the production cap in
  both runs. Nothing measured supports more.

## Follow-up

At 100 bots the line-of-sight budget (`awareness.losRayBudgetPerThink: 600`)
leaves about 87 bots per think job waiting for the next one. 25 to 31 wait at
50 bots and none at 20. A deferred bot perceives on the next job, so at 100
bots perception runs at about half its 10 Hz. Neither board lag nor decision
age shows this. Raising the budget or spreading perception across jobs needs
its own measurement against the added-p95 bar.

## Not measured

- Survival players or chunk generation alongside the bots.
- Heap and RSS.
- The governor stepping up under a forced stall, and recovering (E2E case 10).
- Production hardware: these numbers come from a contended workstation, not
  from `torvalds`.
