# Recyclarr original-language policy

## Status

Complete

## Context

Seerr requests for foreign films/shows (Chinese, Japanese, etc.) failed in
Radarr/Sonarr because the stack effectively required English audio. Desired
policy: grab **original language only** (English when OG is English, native
otherwise).

## Approach

TRaSH "Language: Original Only" via reverse-scored `Language: Not Original` CF
(`-10000`), plus Radarr guide-backed quality profiles that sync
`language: Original`.

Also fixed GitOps drift: live Recyclarr config lived only in a 1Password
`recyclarr.yaml` secret; git `config/recyclarr/*.yaml` was not mounted.

## Session Log — 2026-07-19

### Done

- Git-owned `config/recyclarr/recyclarr.yaml` with original-language CFs +
  Radarr `quality_profiles` trash_ids
- Deployment mounts ConfigMap from git; init extracts API keys from legacy 1P
  yaml into `secrets.yml`
- Split `radarr.yaml` / `sonarr.yaml` kept in sync as documentation views
- PR for the change

### Remaining

- After merge/deploy: bounce recyclarr (or wait for `@daily`) and re-search
  failed foreign titles
- Optional cleanup: replace legacy 1P embedded yaml with discrete
  `RADARR_API_KEY` / `SONARR_API_KEY` fields (init becomes unnecessary)

### Caveats

- Sonarr CF trash_id differs from Radarr
  (`ae575f95…` vs `d6e9318c…`)
- OG language metadata comes from TMDB (movies) / TVDB (TV)
- Profile names must still match what Seerr points at (TRaSH defaults)
