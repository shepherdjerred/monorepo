# Prowlarr AvistaZ + AnimeZ indexers (IaC)

## Status

Complete — both indexers created in prod Prowlarr (AvistaZ id=9, AnimeZ id=8), enabled, and passing Prowlarr's connection test.

## Goal

Add the AvistaZ (`avistaz.to`) and AnimeZ (`animez.to`) private trackers to Prowlarr,
managed the same way as the existing PrivateHD indexer — as OpenTofu resources in
`packages/homelab/src/tofu/arr/`, not hand-added in the Prowlarr UI (which would drift
from code).

## What was verified (from Prowlarr source, `Prowlarr/Prowlarr@develop`)

- `AvistaZ.cs`, `AnimeZ.cs`, `CinemaZ.cs`, `PrivateHD.cs` all extend `AvistazBase` and share
  the **identical `AvistazSettings` contract**: `Username` (site username), `Password`, `PID`
  (all `NotEmpty`/required), plus `FreeleechOnly`. Login endpoint is `<baseUrl>api/v1/jackett/auth`.
- **AvistaZ** — `implementation = "AvistaZ"`, `IndexerUrls = ["https://avistaz.to/"]` (aka AsiaTorrents).
- **AnimeZ** — `implementation = "AnimeZ"`, `IndexerUrls = ["https://animez.to/"]` (ex-AnimeTorrents; anime/manga).
- In-app help text (`Core/en.json`): Username = "Site Username", Password = "Site Password",
  PID = "**PID from My Account or My Profile page**". Warning: "**Only member rank and above can
  use the API** on this indexer."
- So each new resource is a near-clone of the existing `prowlarr_indexer.privatehd`, differing only
  in `implementation`, `name`, `baseUrl`, and the credential locals.

## Changes (branch `feature/arr-avistaz-animez`)

- `src/tofu/arr/resources.tf` — added `prowlarr_indexer.avistaz` and `prowlarr_indexer.animez`
  (created, not imported — they don't exist in Prowlarr yet). Field order/shape copied from
  `privatehd`; no `ignore_changes` (these are C# indexers with a stable field set that must keep
  their creds synced). Username set to `shprd`; seedRatio 3; priority 1; enabled.
- `src/tofu/arr/variables.tf` — added required, non-empty-validated vars `avistaz_password`,
  `avistaz_pid`, `animez_password`, `animez_pid`.
- `src/tofu/arr/locals.tf` — mapped the four vars into `local.arr_api_keys`.
- `scripts/tofu-stack.ts` — added the four `SOURCE → TF_VAR_*` entries to `OPTIONAL_SECRET_ENV`
  (`AVISTAZ_PASSWORD`/`AVISTAZ_PID`/`ANIMEZ_PASSWORD`/`ANIMEZ_PID`) + updated the header doc comment.

## Validation done

- `tofu fmt` clean, `tofu init -backend=false && tofu validate` → **Success! The configuration is valid.**
- `bun scripts/tofu-stack.ts arr plan --dry-run` runs clean (module parses with edits).
- Prettier clean on `tofu-stack.ts`.

## 1Password state (Personal vault)

- Login items exist: `AvistaZ` (username `shprd`), `Animez` (username `shprd`), `PrivateHD`
  (username `root@sjer.red`). AvistaZ/Animez items hold username + password but **no PID field**.
- CI bundle `Buildkite CI Secrets` (id `rzk3lawpk4yspyyu5rxlz44ssi`) has `PRIVATEHD_PASSWORD`/`PRIVATEHD_PID`
  but **nothing for AvistaZ/AnimeZ yet**. The four new `TF_VAR_*` are required with no default, so the
  merge-time `tofu apply arr` will fail unless `AVISTAZ_PASSWORD/PID` + `ANIMEZ_PASSWORD/PID` are added
  to that bundle first. (This item is a CI-injected env source, not an `OnePasswordItem` CRD ref, so the
  cdk8s `check:1password` snapshot does NOT need refreshing.)

## Live validation (before + after apply)

- Reproduced Prowlarr's auth (`POST <baseUrl>api/v1/jackett/auth`, form `username`/`password`/`pid`)
  with 1Password creds: AnimeZ → `HTTP 200` (token). AvistaZ initially `HTTP 401 "Only member rank
and above can use API"` (creds correct, account rank too low); after operator ranked up → `HTTP 200`.
  The wrong-PID case returns a distinct `"Invalid username, password or PID"` — how we knew the rank
  block wasn't a credential problem. (AnimeZ also enforces a 32-char PID.)
- `tofu plan` → `2 to add, 0 to change, 0 to destroy`; `tofu apply` created both (19s each).
- Prowlarr `POST /api/v1/indexer/testall` → ids 8 (AnimeZ) & 9 (AvistaZ) both `isValid=true, 0 failures`.

## 1Password writes made

- `Buildkite CI Secrets` (`rzk3lawpk4yspyyu5rxlz44ssi`, vault `v64ocnykdqju4ui6j6pua56xw4`): added 4
  top-level CONCEALED fields `AVISTAZ_PASSWORD`, `AVISTAZ_PID`, `ANIMEZ_PASSWORD`, `ANIMEZ_PID`
  (passwords copied from the login items, PIDs operator-supplied) — matches the `PRIVATEHD_*` shape.
- `AvistaZ` / `Animez` login items: saved each site's `PID` as a CONCEALED field.

## Session Log — 2026-07-19

### Done

- Added `prowlarr_indexer.avistaz` + `prowlarr_indexer.animez` (+ vars/locals/tofu-stack.ts wiring) on
  branch `feature/arr-avistaz-animez`, commit captures all 5 files. `tofu validate` + `verify --affected` green.
- Stored the 4 CI secrets + 2 login-item PIDs in 1Password.
- `tofu apply arr` created both indexers in prod Prowlarr; verified enabled + passing `testall`.

### Remaining

- Open + merge the PR to land the code on `main` (state already has the resources, so the merge-time
  CI `tofu apply arr` will be a 0-change no-op; the CI secrets are already in the bundle).

### Caveats

- AvistaZ API access requires **member+ rank** on avistaz.to; if the account ever drops below that, the
  indexer's tests/searches will 401 until rank is restored (credentials remain valid).
- Local apply was run against prod state (SeaweedFS backend over tailnet). No `-out` plan file was used.
