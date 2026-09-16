# Bazarr provider overlays

`subhd.py` is discovered by Bazarr's vendor provider registry. `zimuku.py` is
the Bazarr 1.6.0 provider with a local archive-selection correction. Its original
SHA256 is recorded in the header. Both mount as individual read-only files;
built-in providers remain visible. Source hashes restart Bazarr when either
overlay or the startup policy changes.

The Zimuku overlay derives from Bazarr's GPL-3.0 source and is covered by the
repository's [GPL-3.0 license](../../../../../../LICENSE).

Bazarr's built-in Settings provider catalog does not contain a SubHD card.
SubHD is enabled by the repo startup policy; provider results use Bazarr's
discovered backend registry. Existing Settings edits preserve unknown provider
names in the enabled list.

| Boundary       | Contract                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Languages      | Generic `zh` and `zh-CN` requests accept explicitly Simplified SubHD results only. Bilingual alone does not establish script.                                                                           |
| Provenance     | Official, original translation, or other source labels; AI and machine categories are excluded. Attribution inside downloaded text also vetoes acceptance. Labels are claims, not proof of authorship.  |
| Matching       | Episode entries match exact season/episode. Season packs must yield an exact archive member. Release group precedes bilingual preference; tied archive choices fail.                                    |
| Files          | SRT, ASS, SSA; UTF-8 output, 32 MiB download/expansion, 4 MiB subtitle, 200 archive members. Files are read in memory, never extracted onto disk.                                                       |
| Browser        | Dedicated persistent `subhd` profile. Detail page prepares a short-lived ticket, browser navigates to the download page, then authorizes the CDN URL. Cookies and preparation tickets remain in Chrome. |
| CDN            | HTTPS `dl.subhd.me` only; each redirect is revalidated before following. Credential-bearing browser session is separate from public HTTP requests.                                                      |
| Failure        | Browser, source, challenge, missing episode, and ambiguity errors throttle the provider. No arbitrary archive fallback or automated CAPTCHA solver.                                                     |
| Zimuku         | Simplified episode archives require both an exact episode and an explicit filename script marker. Other language/movie behavior retains upstream selection.                                             |
| Startup policy | Idempotently enables SubHD, keeps ASSRT disabled, and excludes OpenSubtitles AI/machine translations. Existing profiles, scores, and embedded-subtitle policy are preserved.                            |

`SUBHD_PINCHTAB_URL` and `SUBHD_PINCHTAB_PROFILE` supply browser bootstrap.
`SUBHD_PINCHTAB_TOKEN` comes from the shared 1Password item mirrored into media.
The token is never sent to SubHD or included in errors.

Fixture verification uses the exact catalog-pinned Bazarr image and its vendor
libraries, with no network access:

```sh
bun run --cwd packages/homelab/src/cdk8s test:bazarr
```

This requires a running Docker engine. CDK integration tests run in the ordinary
CDK8s test task. Production download and Plex playback are separate acceptance
checks; fixture success does not establish either.
