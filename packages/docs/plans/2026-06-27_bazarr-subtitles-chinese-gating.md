# Bazarr subtitle fix + per-Seerr-user Chinese gating

## Status

Proposed (plan mode — not yet approved/implemented)

## Context

Bazarr is healthy but its subtitle pipeline is degraded and its Chinese strategy is essentially absent:

- **Whisper is fully broken (2 bugs):** Bazarr's `whisperai.endpoint` points at a non-existent service
  `http://torvalds-whisperbridge-service:9000` (correct: `media-whisperbridge-service`), and the bridge
  defaults to `WHISPER_MODEL=whisper-1` which Groq does not serve (any real request → 400).
- **Chinese coverage is luck-of-the-embedded:** TV zh-Hans 25% / movies 52%, almost entirely incidental
  embedded tracks. 0 TV series and only 8 movies are on a profile that even requests `zh`. The zh providers
  are degraded (assrt downloads externally broken; zimuku needs funded anti-captcha; whisperai broken).
- **Goal:** (1) fix the subtitle pipeline and broaden Chinese coverage, and (2) make a _specific Seerr user's_
  requests automatically get Chinese subtitles, while everyone else stays English.

Coverage today (code-measured this session): TV 2086 eps / 37 series — EN 99.7%, forced-EN 0.8%, zh-Hans 25.2%.
Movies 65 — EN 98.5%, forced-EN 13.8%, zh-Hans 52.3%. Source: prior session log
`packages/docs/logs/2026-06-27_bazarr-whisper-subtitles-research.md` and the research report at
`~/.claude-extra/research/arr-stack-subtitles.{md,pdf}`.

## Decisions (locked with user)

- Execution: **apply live via API + open the homelab PR**; user does paid signups.
- Paid: **OpenSubtitles.com VIP**, **fund anti-captcha.com** (zimuku), **Gemini API key** (only if Lingarr is built).
- Chinese fill: **providers first**, then machine-translation fallback — **but see "Open decision: Lingarr/MT" below.**
- Seerr Tag Requests: enable on **both** Overseerr 1.35 and Seerr v3.2 (Radarr + Sonarr connections).

## Open decision: Lingarr / machine-translation (NOT yet decided)

The Chinese-fill fallback originally proposed deploying **Lingarr** (self-hosted, integrates with Sonarr/Radarr,
auto-translates new media via an engine — Gemini was chosen). Pressure-testing surfaced caveats:

- Bazarr's built-in Google-translate is **manual-only** by design — can't auto-fill gaps. Automated MT ⇒ Lingarr.
- Lingarr is real and actively maintained but **niche** (~812★, created Dec 2023, little public review chatter);
  quality is the _engine's_, not Lingarr's.
- MT subtitle quality EN→Simplified-Chinese with an LLM (Gemini): **B-grade — watchable, occasionally awkward**,
  weaker on idioms/names/slang; benchmarks also show top models sometimes emit Simplified for _both_ zh-CN/zh-TW
  and that automated metrics overstate quality (must force Simplified + spot-check). Native bilingual `.ass`
  from zimuku/assrt (human fansubs) remains strictly better.

**Recommendation: defer Lingarr.** Ship provider fixes + tag-gating, let it run, re-measure the _real_ Chinese
coverage, then decide if MT is worth a heavy new deployment for the residual gap. (User has not yet chosen between:
defer / build now / drop MT entirely.) Until chosen, Workstream A3 is **conditional**.

## Inputs needed from user (at execution time)

| Input                           | Why                                     | How obtained                                        |
| ------------------------------- | --------------------------------------- | --------------------------------------------------- |
| **Target Seerr username**       | The user whose requests get Chinese     | User provides, or list Seerr users via API and pick |
| **Gemini API key**              | Lingarr EN→zh engine (only if A3 built) | aistudio.google.com → store in 1Password            |
| **OpenSubtitles VIP** purchased | English breadth                         | Upgrade account `shepherdjerred`                    |
| **anti-captcha.com funded**     | Unlock zimuku                           | Add ~$10 (key already in Bazarr config)             |

---

## Workstream A — IaC / code (homelab PR via worktree)

Worktree off `origin/main`, `bun run scripts/setup.ts`, commit per phase, PR at end.

### A1 — Fix the Whisper model (code half of the Whisper bug)

File: `packages/homelab/src/cdk8s/src/resources/torrents/whisperbridge.ts` (env block ~L52-62). Add:

```ts
WHISPER_MODEL: EnvValue.fromValue("whisper-large-v3-turbo"),
WHISPER_TRANSLATE_MODEL: EnvValue.fromValue("whisper-large-v3"),
```

(turbo 400s on Groq's `translate` task → v3 for translation; transcription stays on cheap turbo.)

### A2 — Refresh stale doc

File: `packages/homelab/src/cdk8s/WHISPER.md` — fix `$0.03→$0.04/hr`, drop the `whisper-1`/`100MB` claims,
document the two model env vars and the `media-whisperbridge-service` endpoint.

### A3 — Deploy Lingarr (CONDITIONAL — only if "build now" is chosen above)

Follow the **whisperbridge pattern** (a deployment inside the existing `media` chart, not a brand-new chart):

- New `packages/homelab/src/cdk8s/src/resources/torrents/lingarr.ts` → `createLingarrDeployment(chart, claims)`:
  - Image `lingarr/lingarr` pinned in `src/cdk8s/src/versions.ts` (+ Renovate annotation).
  - Mount `/tv` and `/movies` (reuse `claims.tv` / `claims.movies` like `bazarr.ts`) to read EN subs / write `.zh` sidecars; small ZFS-NVMe PVC (~2Gi) for its DB.
  - Config: Sonarr `media-sonarr-service:8989` + Radarr `media-radarr-service:7878` URLs + API keys; source `en`, target `zh` (Simplified); engine **Gemini**; translate **only when target missing**.
  - `Service` + `TailscaleIngress` host `lingarr` (match `bazarr.ts`).
- Wire into `src/cdk8s/src/cdk8s-charts/media.ts` (alongside whisperbridge/bazarr).
- Secrets via **OnePasswordItem** (Gemini key); then refresh `src/cdk8s/onepassword-vault-snapshot.json`
  (`bun run scripts/snapshot-1password-vault.ts`) and run `scripts/check-1password-items.ts` — required or CI fails.
- Verify at build: exact image tag, env var names, whether config is env-only or needs a first-run UI step.

---

## Workstream B — Live runtime config (applied via Bazarr/Seerr APIs; not in git)

Bazarr internal settings live in its `/config` PVC, not IaC — applied via `POST /api/system/settings`
(apikey from `/config/config/config.yaml`).

### B1 — Fix the Whisper endpoint (config half of the Whisper bug)

Bazarr → set `whisperai.endpoint` = `http://media-whisperbridge-service:9000`. Immediate; independent of A1.

### B2 — Provider cleanup + paid tiers

- **Remove** `wizdom` (Hebrew-only).
- **Add** free English providers: `gestdown`, `subdl`, `subsource`, `yifysubtitles` (keep `opensubtitlescom`).
  Note: `subdl`/`subsource` may need free API keys.
- **OpenSubtitles.com:** set `include_ai_translated=false`. VIP applies automatically once the account is upgraded.
- **zimuku:** confirm enabled (it is) + anti-captcha funded (user).
- Keep `assrt` enabled (best-effort; downloads externally broken).

### B3 — Chinese tag-gating (the "user request thing")

Verified against Bazarr source (`bazarr/{sonarr,radarr}/sync/parser.py` → `get_matching_profile`): profile
assigned when the item's Sonarr/Radarr tag **exactly** matches a Bazarr profile's `tag` (first match wins);
no match → default profile.

1. **Seerr (both Overseerr + Seerr v3.2):** Settings → Services → each **Radarr** and **Sonarr** connection →
   toggle **"Tag Requests" → On**. Each request tags the item with the requester (`<id> - <name>`, lowercased).
2. **Identify the target user's exact tag** in Radarr/Sonarr (case-sensitive — copy literally; Overseerr #4306).
3. **Bazarr:** set the existing **"Chinese" profile (#2 = zh, zt, en, en-forced)** `tag` field = that tag;
   enable **Settings → Languages → "Tag-Based Automatic Language Profile Selection"** for **Series + Movies**
   (`serie_tag_enabled` / `movie_tag_enabled`). Keep default profile = **English (#1)**.

### B4 — Backfill + trigger

- Optionally tag the target user's **existing** requested items in Radarr/Sonarr (Bazarr re-evaluates on tag
  change → they switch to Chinese) — via the HStep20 backfill script or manually.
- Run Bazarr "Search for Wanted". Mind OpenSubtitles caps (VIP helps) + assrt 20 req/min.

---

## Sequencing

1. **B1** (endpoint) + **B2** (providers) — immediate, low-risk, no deploy.
2. **A1/A2** PR → merge → ArgoCD deploys model fix → Whisper works end-to-end.
3. **B3** (Seerr Tag Requests + Bazarr tag profile) once target username provided.
4. **Re-measure Chinese coverage** → decide Lingarr (A3) per "Open decision" above.
5. **A3** (Lingarr) only if chosen; then **B4** backfill + re-measure.

## Risks / caveats

- Live Bazarr/Seerr config is **not version-controlled** (no IaC for app-internal settings) — documented here.
- Tag match is **case-sensitive**; Radarr/Sonarr lowercase tags — mirror the literal tag into Bazarr.
- Tag Requests tags **new** requests only; existing items need backfill (B4).
- MT (if Lingarr built) is a **quality compromise** (B-grade) vs human fansub bilingual `.ass`; force Simplified + spot-check.
- Forced-English stays hard (embedded-only, gated on the forced disposition bit) — **out of scope**.
- Adding the Lingarr OnePasswordItem requires the snapshot refresh or CI's 1Password gate fails.

## Verification

- **Whisper:** after A1 deploy + B1, manual-search an episode with the Whisper provider → no 400; whisperbridge logs show `model: whisper-large-v3-turbo`.
- **Providers:** Bazarr → System → Providers all "Good"; wizdom gone.
- **Tag gating:** test-request as the target user in each Seerr → tag appears in Radarr/Sonarr → that item shows the **Chinese** profile in Bazarr and searches zh; a non-target request stays **English**.
- **Lingarr (if built):** translate a test item lacking zh → `.zh.srt` written next to media; Plex/Bazarr see it.
- **Coverage:** re-run the coverage script after a few days; expect zh-Hans to climb for the target user's library.

## Out of scope / deferred

- Forced-English improvement (embedded-extraction-only; low ROI).
- Migrating off Groq for Whisper; bilingual file _merging_ (native bilingual `.ass` via the zh channel already covers most).
- Consolidating Overseerr vs Seerr (user runs both).

## Session Log — 2026-06-27

### Done

- Drafted this plan (Bazarr subtitle fix + per-Seerr-user Chinese gating) and saved it to `packages/docs/plans/`.
- Verified, read-only against the live cluster: current Bazarr config/providers/profiles, library coverage, the
  two Whisper bugs, the Seerr→Radarr/Sonarr→Bazarr tag mechanism (against Bazarr source), and Lingarr/MT quality.

### Remaining

- User to decide the **Lingarr/MT** question (defer recommended / build now / drop MT).
- User inputs: target Seerr username; (if MT) Gemini key; purchase OS VIP; fund anti-captcha.
- Then execute Workstreams A + B per sequencing. Mirror final approved plan stays here; archive to
  `packages/docs/archive/completed/` once shipped.

### Caveats

- Plan not yet approved (ExitPlanMode was declined pending the Lingarr decision).
- Live Bazarr/Seerr config changes are not version-controlled — this doc is the record.
