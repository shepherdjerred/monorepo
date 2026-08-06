---
id: reference-completed-2026-05-16-scout-loading-screen-role-inference
type: reference
status: complete
board: false
---

# Scout Loading Screen Role Inference

## Goal

Order standard 5v5 Scout loading screens by inferred lane, without rendering role labels, slot numbers, or confidence values. Keep ARAM and Arena layouts unchanged.

## Implementation Notes

- Standard loading-screen data is now layout-discriminated and requires `lane` on standard participants.
- Lane inference uses checked-in priors generated from Scout S3 Match-V5 postgame archives.
- Runtime rendering is offline and reads only the checked-in prior artifact.
- The eval command blinds postgame-only fields before inference and gates on participant accuracy.
- Temporal Data Dragon updates now regenerate lane priors and run the eval gate in the same cloned checkout before PR creation.

## S3 Artifact

- Training source: `2026-05-06` through `2026-05-13`
- Holdout source: `2026-05-14` through `2026-05-16`
- Queues: `400`, `420`, `440`, `480`, `490`
- Training matches: `621`
- Holdout matches: `100`
- Holdout participants: `1000`
- Eval threshold: `0.95`
- Eval accuracy: `0.979`
