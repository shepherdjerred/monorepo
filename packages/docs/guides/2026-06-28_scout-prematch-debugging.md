---
id: guide-2026-06-28-scout-prematch-debugging
type: guide
status: complete
board: false
---

# Debugging Scout Prematch / Loading-Screen Issues

## Status Notes (Historical)

Complete (reference)

- **Raw spectator payloads are archived to S3** at `s3://scout-prod/prematch/<YYYY>/<MM>/<DD>/<gameId>/spectator-data.json` (`storage-s3-prematch.ts`). Read with the `seaweedfs` AWS profile: `aws s3api get-object --bucket scout-prod --key ... --profile seaweedfs`. Invaluable for the exact `gameLength`, `gameQueueConfigId`, and participant count — Bugsink event tags only carry `source/gameId/queue/map/mode`, NOT gameLength/participants.
- **Pre-start lobby signal:** during the pre-game countdown, Spectator reports `gameLength < 0` (e.g. −17 to −58s) and a partial roster (2–4 of 10). This caused matched ARAM event modes (Mayhem/KIWI, queues 3200/3220/3270) to produce the `participants .length(10)` ZodError. `gameStartTime` is non-zero pre-start, so it is NOT a reliable "started" signal — use `gameLength`. `isLikelyPreStartLobby` (`active-game-detection.ts`) now defers any non-Arena lobby with <10 participants.
- **`twisted`'s champion enum chronically lags Data Dragon** (1.73.0 and even 1.81.0 cap at 804/Yunara, no 805/Locke). Scout resolves champion id→key from the bundled `champion.json` via `getChampionKeyById` (`data/images.ts`) as a fallback in `resolveChampionKey`; refreshing assets (`update-data-dragon`) handles new champs without bumping `twisted`.
