---
id: log-2026-07-19-recyclarr-original-language
type: log
status: complete
board: false
---

# Recyclarr living-room Best profiles

## Context

Seerr foreign-language failures plus a broader living-room quality goal:

- Best-effort up to 4K (fallback when needed)
- Size ceiling ~100–120 GiB @ ~2 hr (1100 MB/min)
- Original audio only
- Gear: QN90B + ATV 4K 2021 + Sonos Arc (Atmos) + Sub + Era 100s

## Approach

Single **Best** profile each for Radarr/Sonarr in git-owned `recyclarr.yaml`:

- Movies: Remux-2160p → Bluray-2160p → WEB-2160p → 1080p/720p
- TV: WEB-2160p → Bluray-2160p → WEB-1080p → 720p
- Language CF −10000; Radarr SQP trash_id keeps `language: Original`
- HDR + HDR10+; mild DD+ Atmos (TrueHD/DTS:X scored 0)
- Quality definition max 1100 MB/min on top 4K tiers
- ConfigMap from git; init extracts API keys from legacy 1P yaml

## Session Log — 2026-07-19

### Done

- `config/recyclarr/recyclarr.yaml` Best profiles + language + size + Atmos
- Deployment ConfigMap mount + secrets.yml init
- PR #1582

### Remaining

- After merge: recyclarr sync; set Seerr defaults to **Best**
- Re-search failed foreign titles
- Optional: discrete 1P API key fields (drop init)

### Caveats

- Seerr must use profile name `Best` (old HD/UHD/Remux names removed from sync)
- Size cap is MB/min (very long films can still exceed 120 GiB absolute)
- OG language from TMDB/TVDB
