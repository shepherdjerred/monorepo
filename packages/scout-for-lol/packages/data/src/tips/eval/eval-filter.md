# Sonnet as a filter

Every tip the three generators wrote in the eval (both runs each) was re-judged by Sonnet with the same grounding and lookup tool, as batches and without regenerating anything, then compared with what the two reference judges (Opus and GPT) said. "Both refs wrong" are the tips the filter should catch; a "false drop" is a tip the filter calls wrong that both references call correct. Variants: sonnet-medium (227 units, $1.16 at the batch price, $6.88 at the standard price); sonnet-low (227 units, $1.34 at the batch price, $6.67 at the standard price).

| Filter        | Generator         | Tips | Both refs wrong | Caught | Recall | False drops | False-drop rate | Dropped share | Shipped wrong   | Own wrong | Own useful |
| ------------- | ----------------- | ---- | --------------- | ------ | ------ | ----------- | --------------- | ------------- | --------------- | --------- | ---------- |
| sonnet-medium | all three         | 1280 | 99              | 83     | 83.8%  | 263 of 956  | 27.5%           | 34.8%         | 1.9% (was 7.7%) | 34.8%     | 71.0%      |
| sonnet-medium | claude-haiku-5-5  | 433  | 39              | 31     | 79.5%  | 85 of 331   | 25.7%           | 35.1%         | 2.8% (was 9.0%) | 35.1%     | 67.2%      |
| sonnet-medium | claude-sonnet-5-5 | 410  | 33              | 27     | 81.8%  | 71 of 288   | 24.7%           | 33.4%         | 2.2% (was 8.0%) | 33.4%     | 75.9%      |
| sonnet-medium | claude-opus-5-5   | 437  | 27              | 25     | 92.6%  | 107 of 337  | 31.8%           | 35.7%         | 0.7% (was 6.2%) | 35.7%     | 70.3%      |
| sonnet-low    | all three         | 1280 | 99              | 81     | 81.8%  | 258 of 956  | 27.0%           | 34.2%         | 2.1% (was 7.7%) | 34.2%     | 68.8%      |
| sonnet-low    | claude-haiku-5-5  | 433  | 39              | 31     | 79.5%  | 87 of 331   | 26.3%           | 34.6%         | 2.8% (was 9.0%) | 34.6%     | 63.0%      |
| sonnet-low    | claude-sonnet-5-5 | 410  | 33              | 28     | 84.8%  | 64 of 288   | 22.2%           | 30.7%         | 1.8% (was 8.0%) | 30.7%     | 76.1%      |
| sonnet-low    | claude-opus-5-5   | 437  | 27              | 22     | 81.5%  | 107 of 337  | 31.8%           | 37.1%         | 1.8% (was 6.2%) | 37.1%     | 67.5%      |

## Measured batch and cache savings

One real batch: the 10 most-played Akali matchups in Mid, generated with Haiku and the 8 accepted ones judged with Sonnet, each prompt leading with Akali's block as a 1h cache breakpoint. "Standard" is the same tokens at the list price with nothing cached; "cache alone" is the saving against half that (the batch price with no cache).

| Stage      | Model             | Jobs          | Lookups | Prompt tokens read from cache | Standard price | Actual | Saved in total | Saved by cache alone | Wall time |
| ---------- | ----------------- | ------------- | ------- | ----------------------------- | -------------- | ------ | -------------- | -------------------- | --------- |
| generation | claude-haiku-5-5  | 10 (0 failed) | 0       | 64.1%                         | $0.02          | $0.01  | 70.3%          | 40.6%                | 320s      |
| judging    | claude-sonnet-5-5 | 8 (0 failed)  | 0       | 55.7%                         | $0.28          | $0.08  | 71.1%          | 42.2%                | 305s      |

Cache behavior that feeds the projection: generation prefix share 64.1% of the prompt, hit rate 100.0%; judging prefix share 55.7%, hit rate 100.0%. Price multipliers (from the catalog): batch 0.5, cache read 0.05 of input, 1h cache write 2 of input.

## Projection

Full run: 2578 pairs and 220 general sets, 170 distinct leading champions, so each prefix is shared by 16.5 units on average. Typical patch: 12 champions changed, every unit touching them regenerated and re-filtered. Tokens per unit are the eval's (generator) and the re-judge's (filter); both stages at the batch price with the measured cache hit rate. Shipped wrong is the share of kept tips that both reference judges call wrong.

| Generator + filter                | Full run | of which generation / filter | Typical patch | Shipped wrong   | Dropped share | False-drop rate | Under $100 |
| --------------------------------- | -------- | ---------------------------- | ------------- | --------------- | ------------- | --------------- | ---------- |
| claude-haiku-5-5 + sonnet-medium  | $30      | $3.13 / $26                  | $3.93         | 2.8% (was 9.0%) | 35.1%         | 25.7%           | yes        |
| claude-sonnet-5-5 + sonnet-medium | $68      | $41 / $27                    | $8.86         | 2.2% (was 8.0%) | 33.4%         | 24.7%           | yes        |
| claude-opus-5-5 + sonnet-medium   | $97      | $70 / $27                    | $13           | 0.7% (was 6.2%) | 35.7%         | 31.8%           | yes        |
| claude-haiku-5-5 + sonnet-low     | $29      | $3.13 / $25                  | $3.79         | 2.8% (was 9.0%) | 34.6%         | 26.3%           | yes        |
| claude-sonnet-5-5 + sonnet-low    | $67      | $41 / $26                    | $8.72         | 1.8% (was 8.0%) | 30.7%         | 22.2%           | yes        |
| claude-opus-5-5 + sonnet-low      | $96      | $70 / $26                    | $13           | 1.8% (was 6.2%) | 37.1%         | 31.8%           | yes        |
