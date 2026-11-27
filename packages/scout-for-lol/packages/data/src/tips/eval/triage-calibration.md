# Triage calibration

Against the 1,280 tips the two reference judges (Opus and GPT) labelled, with the Decisions p(wrong) of each. "Both-wrong" is a tip both references call wrong. Chosen thresholds: lo 0.15, hi 0.85 (31% kept at 1.8% shipped wrong, 9.5% sent straight to repair, the rest escalated). Decisions' p(wrong) is a weak signal at the high end (at 0.85, 27% of what it sends to repair is both-wrong and 41% is both-correct), so the repair step may return a tip unchanged, and only the low end is trusted to keep a tip.

1280 tips, 99 both-refs-wrong (7.7%); 148 state an interaction (11.6%), 19.2% of the both-wrong tips among them

| lo   | hi  | keep  | repair | escalate | wrong kept (miss) | shipped wrong | repair that refs call wrong | repair that refs call correct | both-wrong reaching escalate or repair |
| ---- | --- | ----- | ------ | -------- | ----------------- | ------------- | --------------------------- | ----------------------------- | -------------------------------------- |
| 0.05 | 0.5 | 14.5% | 27.4%  | 58.1%    | 1 of 99           | 0.5%          | 16.0%                       | 56.7%                         | 99.0%                                  |
