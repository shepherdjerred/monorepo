# The Decisions API as a judge

OpenAI's Decisions API (`POST /v1/decisions`, model gpt-6-luna) answers several bounded questions about one input and returns a probability for each answer. Each unit's prefetched grounding and wiki notes go in as the input, followed by its tips; every tip gets a correct / wrong / not checkable choice and a useful yes/no. It has no tool use, so it judges from the grounding alone. The same 227 units (both runs of the three generators) were re-judged, with no regeneration, and measured against the two reference judges exactly as the Sonnet variants were: "both refs wrong" are the tips the filter should catch, a "false drop" is a tip it calls wrong that both references call correct.

| Filter                             | Tips | Both refs wrong | Caught | Recall | False drops | False-drop rate | Dropped share | Shipped wrong   | Own useful |
| ---------------------------------- | ---- | --------------- | ------ | ------ | ----------- | --------------- | ------------- | --------------- | ---------- |
| Decisions, likeliest answer        | 1280 | 99              | 58     | 58.6%  | 214 of 956  | 22.4%           | 29.5%         | 4.5% (was 7.7%) | 96.3%      |
| Decisions, drop at p(wrong) >= 0.5 | 1280 | 99              | 56     | 56.6%  | 199 of 956  | 20.8%           | 27.4%         | 4.6% (was 7.7%) | 96.3%      |
| Decisions, drop at p(wrong) >= 0.3 | 1280 | 99              | 77     | 77.8%  | 361 of 956  | 37.8%           | 45.0%         | 3.1% (was 7.7%) | 96.3%      |
| Decisions, drop at p(wrong) >= 0.2 | 1280 | 99              | 87     | 87.9%  | 490 of 956  | 51.3%           | 58.7%         | 2.3% (was 7.7%) | 96.3%      |
| Decisions, drop at p(wrong) >= 0.1 | 1280 | 99              | 96     | 97.0%  | 651 of 956  | 68.1%           | 73.4%         | 0.9% (was 7.7%) | 96.3%      |
| sonnet-medium                      | 1280 | 99              | 83     | 83.8%  | 263 of 956  | 27.5%           | 34.8%         | 1.9% (was 7.7%) | 71.0%      |
| sonnet-low                         | 1280 | 99              | 81     | 81.8%  | 258 of 956  | 27.0%           | 34.2%         | 2.1% (was 7.7%) | 68.8%      |

## Cost and latency

Decisions: $0.2097 for 227 units ($0.00092 per unit; output tokens are free, 3.0% of the 1804266 input tokens were served from the cache). One request per unit, 8 in flight: 9s for the whole set; per request mean 0.3s, p95 0.6s, max 0.8s. It answers synchronously, so a full run needs no batch wait.

Sonnet for comparison: sonnet-medium: $0.0051 per unit at the batch price; sonnet-low: $0.0059 per unit at the batch price; its batches take minutes to tens of minutes.
