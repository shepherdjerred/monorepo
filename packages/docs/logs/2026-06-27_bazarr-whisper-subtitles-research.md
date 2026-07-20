---
id: log-2026-06-27-bazarr-whisper-subtitles-research
type: log
status: complete
board: false
---

# Bazarr: Whisper health check + subtitle-strategy research

## Context

Session started with "check out whisperai for bazarr." Turned into (1) a health/diagnosis pass on the
existing Whisper integration, (2) a cost/worthwhile analysis incl. OpenAI vs Groq, and (3) a deep-research
report on subtitle strategy for four targets: forced-English, full-English, English+Simplified-Chinese,
and Simplified-Chinese.

## Key findings

### Bazarr service health — GOOD

- Pod `media-bazarr-*` Running, 1/1, mem 435Mi / 3Gi limit (14%), config PVC 13M / 8Gi (1%).
- 2 restarts but both `exitCode 0 / Completed` (clean, not OOMKills). The 3Gi bump (post-2026-05-07 OOM) is holding.

### Whisper for Bazarr — BROKEN (two stacked bugs)

1. **Bug A (active blocker):** Bazarr's web-UI Whisper ("whisperai") provider is configured to call
   `http://torvalds-whisperbridge-service:9000`, which does **not** resolve. The real service is
   `media-whisperbridge-service`. Bazarr logs `Name does not resolve` and throttles whisperai 24h.
   Fix = correct the endpoint in Bazarr UI → Settings → Providers → Whisper to
   `http://media-whisperbridge-service:9000`. (Web-UI/PVC config, not in git.)
2. **Bug B (latent, behind A):** `whisperbridge.ts` sets only `TZ`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
   so the McCloud bridge defaults `WHISPER_MODEL=whisper-1` — which **Groq does not serve** (live model
   list: `whisper-large-v3`, `whisper-large-v3-turbo`). Any real request → Groq 400. Fix = add
   `WHISPER_MODEL=whisper-large-v3-turbo` and `WHISPER_TRANSLATE_MODEL=whisper-large-v3` to the container
   env in `packages/homelab/src/cdk8s/src/resources/torrents/whisperbridge.ts` (turbo 400s on the
   translate task). Also update stale `WHISPER.md` ($0.03/hr → $0.04; whisper-1/100MB claims).

### Cost (live pricing, verified)

- Groq STT: `whisper-large-v3-turbo` $0.04/hr, `whisper-large-v3` $0.111/hr (free tier covers casual use).
- OpenAI `whisper-1` $0.36/hr (9x Groq turbo) and slower/older model; gpt-4o-transcribe family is unusable
  with this bridge (no verbose_json + timestamps). → Stay on Groq.

### assrt provider DNS failure — external, root-caused

- Bazarr also logs `Failed to resolve 'file1.assrt.net'`. Root cause: `file0/1/2.assrt.net` CNAME to
  `glb.assrt.net` (DNSPod GSLB), which returns no A record from any public resolver (Google/Cloudflare/
  AliDNS/DNSPod). assrt-side fault, intermittent, not fixable from our side. Not GFW. Search host
  (`api.assrt.net`) is a stable US IP and works.

## Deliverable

Deep-research report (4 parallel investigators + adversarial review that cross-checked Bazarr source code):

- `~/.claude-extra/research/arr-stack-subtitles.md` (full, ~30 cited sources)
- `~/.claude-extra/research/arr-stack-subtitles.typ` + `.pdf` (scannable summary)

Headline conclusions: English is solved (OpenSubtitles.com VIP + Gestdown + Subdl + SubSource + YIFY +
Whisper). Simplified Chinese is fragile but pay-fixable (fund anti-captcha.com → zimuku; OS VIP; assrt
best-effort). Bilingual EN+zh comes free through the _Chinese (Simplified)_ channel (fansub .ass is
bilingual) — there is NO selectable "Chinese bilingual" language (OS code `ze`/`zhe` is not mapped in
Bazarr). Forced-English = embedded extraction only (gated on the forced disposition bit). Whisper only
translates INTO English and can't do forced. Plex shows one sub track at a time (Jellyfin/mpv do two).
Model all targets in one profile, three rows; Whisper score floors are ~67% (eps) / 50% (movies).

## Session Log — 2026-06-27

### Done

- Diagnosed Bazarr health (good) and the two Whisper bugs (hostname mismatch + missing WHISPER_MODEL) via kubectl.
- Verified Groq vs OpenAI STT pricing; produced cost scenarios.
- Root-caused the assrt `file1.assrt.net` DNS failure to assrt's `glb.assrt.net` GSLB.
- Ran a 4-agent deep-research investigation + adversarial review; delivered MD/Typst/PDF report to ~/.claude-extra/research/.

### Remaining

- User decision pending on fixing Whisper: (A) correct Bazarr UI endpoint to `media-whisperbridge-service:9000`
  (manual, web UI); (B) PR `WHISPER_MODEL`/`WHISPER_TRANSLATE_MODEL` into `whisperbridge.ts` + refresh `WHISPER.md`.
- Optional: act on subtitle-strategy report (OpenSubtitles VIP, fund anti-captcha for zimuku, enable
  Embedded Subtitles provider for forced-EN, set up the 3-row language profile).

### Caveats

- No code changed this session. The Bazarr UI endpoint fix is not in git (lives in the /config PVC).
- OpenSubtitles free daily cap (~20) and the Whisper movie-score denominator (120 vs wiki's 180) had
  source conflicts; report flags them. assrt DNS fault is time-bound and may self-recover.

## Session Log — 2026-06-27 (continued)

### Done (additional)

- **Live Bazarr config audit** (read-only, via `kubectl exec` + SQLite read of `/config/db/bazarr.db`):
  - Providers enabled: `opensubtitlescom` (creds ok, `include_ai_translated=true`), `assrt` (token set, downloads broken),
    `zimuku` (anti-captcha key set), `wizdom` (Hebrew — useless), `whisperai` (broken). Languages enabled: en, zh, zt.
  - Profiles: #1 "English" `[en, en-forced]` = default for ALL TV + 57/65 movies; #2 "Chinese" `[zh, zt, en, en-forced]`
    = only 8 movies, 0 TV. Scores 90/80. `use_embedded_subs=true`; Embedded Subtitles _provider_ NOT enabled.
    Subsync on (96/86). Bazarr's `whisperai.endpoint` confirmed wrong: `torvalds-whisperbridge-service` → should be `media-whisperbridge-service`.
- **Coverage measured (code) across the real library:**
  - TV (2086 eps / 37 series): EN 99.7%, forced-EN 0.8%, zh-Hans 25.2% (incidental embedded — 18/37 series have ZERO zh), EN+zh 25.2%.
  - Movies (65): EN 98.5% (1 missing: _Pokémon the Movie 2000_), forced-EN 13.8%, zh-Hans 52.3% (mostly embedded; only 4 downloaded), EN+zh 52.3%.
- **Per-user Chinese gating mechanism verified end-to-end** (against Bazarr source `bazarr/{sonarr,radarr}/sync/parser.py` → `get_matching_profile`):
  Seerr **"Tag Requests"** → tags the item in Radarr/Sonarr with the requester → Bazarr **"Tag-Based Automatic Language Profile Selection"**
  (`serie_tag_enabled`/`movie_tag_enabled` + profile `tag` field, exact case-sensitive match) assigns the Chinese profile. Confirmed deployed: both Overseerr 1.35 and Seerr v3.2.
- **Lingarr / machine-translation** evaluated: Bazarr's built-in Google-translate is manual-only; automated EN→zh needs Lingarr
  (Gemini/DeepL/etc.). Quality with LLM engine ≈ B-grade; native bilingual `.ass` is strictly better → MT is a tail-filler only.
- **Docs produced:**
  - Plan: `packages/docs/plans/2026-06-27_bazarr-subtitles-chinese-gating.md` (subtitle fix + per-user Chinese gating; Lingarr flagged as open decision).
  - Guide: `packages/docs/guides/2026-06-27_arr-stack-subtitle-strategy.md` (the cited research, indexed in `index.md`).

### Remaining (additional)

- Open decision: Lingarr/MT — defer (measure real-provider coverage first) / build now with Gemini / drop MT. Defer recommended.
- Need target Seerr username for the gating; plan not yet approved/executed (ExitPlanMode declined pending Lingarr decision).

### Caveats (additional)

- All work this session was read-only against the cluster + doc writes. No live Bazarr/Seerr config or homelab code changed.
- Plex token, provider creds, and API keys were read but not exposed.
