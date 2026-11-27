# Tip eval summary

Generator models compared on the same 40 cases and prompt (`tips-2`). Each unit is judged by two judge models from different families, claude-opus-5-5 and gpt-6.1-terra, each with the wiki ability notes and a lookup tool (`judge-2`). Each cell is the mean of the model's runs, with each run in brackets: the run-to-run spread. Costs are the generator's only. The projections scale the per-case cost by the plan: 30.3 pair units and 1.3 general sets per champion; a patch that changes 12 champions regenerates all of them. A patch whose changed facts leave the text valid is re-stamped for nothing instead.

|                                                                      | claude-haiku-5-5            | claude-sonnet-5-5           | claude-opus-5-5             |
| -------------------------------------------------------------------- | --------------------------- | --------------------------- | --------------------------- |
| First-attempt pass rate                                              | 68.8% (75.0% / 62.5%)       | 67.5% (67.5% / 67.5%)       | 83.7% (82.5% / 85.0%)       |
| Final pass rate (after one retry)                                    | 97.5% (100.0% / 95.0%)      | 88.8% (92.5% / 85.0%)       | 97.5% (97.5% / 97.5%)       |
| Dropped units (of 40)                                                | 1.0 (0.0 / 2.0)             | 4.5 (3.0 / 6.0)             | 1.0 (1.0 / 1.0)             |
| Judged wrong, claude-opus-5-5                                        | 12.7% (12.2% / 13.2%)       | 11.6% (13.6% / 9.6%)        | 6.9% (7.2% / 6.5%)          |
| Judged wrong, gpt-6.1-terra                                          | 16.4% (14.5% / 18.4%)       | 17.8% (18.8% / 16.8%)       | 16.7% (16.2% / 17.2%)       |
| Judged wrong by both judges                                          | 9.0% (7.7% / 10.4%)         | 8.0% (10.3% / 5.6%)         | 6.2% (6.3% / 6.0%)          |
| Judged correct, claude-opus-5-5                                      | 84.3% (85.5% / 83.0%)       | 81.6% (78.4% / 84.8%)       | 87.4% (86.9% / 87.9%)       |
| Judged correct, gpt-6.1-terra                                        | 80.1% (81.5% / 78.8%)       | 75.9% (74.2% / 77.7%)       | 80.1% (80.6% / 79.5%)       |
| Judged not checkable, claude-opus-5-5                                | 3.0% (2.3% / 3.8%)          | 6.8% (8.0% / 5.6%)          | 5.7% (5.9% / 5.6%)          |
| Judged not checkable, gpt-6.1-terra                                  | 3.5% (4.1% / 2.8%)          | 6.3% (7.0% / 5.6%)          | 3.2% (3.1% / 3.3%)          |
| Judged useful, claude-opus-5-5                                       | 69.0% (72.9% / 65.1%)       | 82.8% (79.8% / 85.8%)       | 89.5% (87.8% / 91.2%)       |
| Judged useful, gpt-6.1-terra                                         | 87.1% (87.8% / 86.3%)       | 93.5% (92.5% / 94.4%)       | 94.7% (94.6% / 94.9%)       |
| Judged plain (mean of judges)                                        | 84.2% (83.7% / 84.7%)       | 79.7% (78.4% / 81.0%)       | 88.1% (88.1% / 88.1%)       |
| Judges agree on correctness                                          | 87.1% (86.9% / 87.3%)       | 80.5% (80.8% / 80.2%)       | 84.9% (86.9% / 82.8%)       |
| Judge agreement, Cohen's kappa                                       | 0.57 (0.54 / 0.60)          | 0.44 (0.50 / 0.39)          | 0.47 (0.54 / 0.40)          |
| Generator tool calls per unit                                        | 0.00 (0.00 / 0.00)          | 0.00 (0.00 / 0.00)          | 0.00 (0.00 / 0.00)          |
| Wiki pages used per unit                                             | 3.50 (3.50 / 3.50)          | 3.50 (3.50 / 3.50)          | 3.50 (3.50 / 3.50)          |
| Judge tool calls per unit                                            | 2.20 (2.15 / 2.25)          | 3.06 (3.08 / 3.05)          | 3.12 (3.33 / 2.90)          |
| Cost per matchup pair                                                | $0.0034 ($0.0032 / $0.0036) | $0.0515 ($0.0531 / $0.0500) | $0.0897 ($0.0904 / $0.0890) |
| Cost per general set                                                 | $0.0020 ($0.0020 / $0.0020) | $0.0363 ($0.0339 / $0.0387) | $0.0591 ($0.0613 / $0.0569) |
| Full run (2578 pairs + 220 general)                                  | $9.23 ($8.75 / $9.72)       | $140.80 ($144.29 / $137.30) | $244.26 ($246.53 / $241.99) |
| Typical patch (12 champions changed, every touched unit regenerated) | $1.27 ($1.20 / $1.34)       | $19.31 ($19.84 / $18.78)    | $33.57 ($33.85 / $33.28)    |

## Source use

The share of tips (generator) and verdicts (judges) that name each source as what they rest on. The generator's share is the mean over a model's runs; a judge's is pooled over every report. A tip or verdict may name several sources. `wiki-lookup` is a page fetched through the tool; the other sources are in every prompt.

| Source            | generator claude-haiku-5-5 | generator claude-sonnet-5-5 | generator claude-opus-5-5 | judge claude-opus-5-5 | judge gpt-6.1-terra |
| ----------------- | -------------------------- | --------------------------- | ------------------------- | --------------------- | ------------------- |
| ability-facts     | 84.3%                      | 88.0%                       | 76.4%                     | 78.6%                 | 74.1%               |
| mechanics         | 6.0%                       | 5.1%                        | 4.4%                      | 4.5%                  | 3.2%                |
| patch-changes     | 0.0%                       | 0.0%                        | 0.5%                      | 0.3%                  | 0.0%                |
| riot-tips         | 16.2%                      | 31.0%                       | 43.7%                     | 28.1%                 | 21.5%               |
| wiki-notes        | 62.6%                      | 51.4%                       | 55.8%                     | 81.7%                 | 58.6%               |
| wiki-lookup       | 0.0%                       | 0.0%                        | 0.0%                      | 4.5%                  | 26.8%               |
| general-knowledge | 4.9%                       | 10.0%                       | 6.2%                      | 3.0%                  | 0.1%                |
