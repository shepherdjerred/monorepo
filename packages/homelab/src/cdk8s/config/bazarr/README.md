# Bazarr provider overlays

`subhd.py` is discovered by Bazarr's vendor provider registry. `zimuku.py` is
the Bazarr 1.6.0 provider with a local archive-selection correction. Its original
SHA256 is recorded in the header. `assrt.py` is the matching Bazarr provider
with strict content validation. `chinese_script.py` verifies subtitle text
against OpenCC's Apache-2.0 character tables. The overlays mount as individual
read-only files; built-in providers remain visible. Source hashes restart Bazarr
when an overlay or the startup policy changes.

The Zimuku and ASSRT overlays derive from Bazarr's GPL-3.0 source and are covered by the
repository's [GPL-3.0 license](../../../../../../LICENSE).

Bazarr's built-in Settings provider catalog does not contain a SubHD card.
SubHD is enabled by the repo startup policy; provider results use Bazarr's
discovered backend registry. Existing Settings edits preserve unknown provider
names in the enabled list.

| Boundary       | Contract                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Languages      | Generic `zh` and `zh-CN` requests accept only text with at least five Simplified-only characters and no Traditional-only characters. Bilingual alone does not establish script.                                                                            |
| Provenance     | Official, original translation, or other source labels; AI and machine categories are excluded. Attribution inside downloaded text also vetoes acceptance. Labels are claims, not proof of authorship.                                                     |
| Matching       | Episode entries match exact season/episode. Season packs must yield an exact archive member. Release group precedes bilingual preference; tied archive choices fail.                                                                                       |
| Files          | SRT, ASS, SSA; UTF-8 output, 32 MiB download/expansion, 4 MiB subtitle, 200 archive members. Files are read in memory, never extracted onto disk.                                                                                                          |
| Browser        | Dedicated persistent `subhd` profile. Detail page prepares a short-lived ticket, browser navigates to the download page, then authorizes the CDN URL. Cookies and preparation tickets remain in Chrome.                                                    |
| CDN            | HTTPS `dl.subhd.me` only; each redirect is revalidated before following. Credential-bearing browser session is separate from public HTTP requests.                                                                                                         |
| Failure        | Browser, source, challenge, missing episode, and ambiguity errors throttle the provider. No arbitrary archive fallback or automated CAPTCHA solver.                                                                                                        |
| Zimuku         | Simplified episode archives require both an exact episode and an explicit filename script marker. Other language/movie behavior retains upstream selection.                                                                                                |
| Startup policy | Enables SubHD and ASSRT when its configured token is present. It creates Sonarr's `chinese` tag and maps it to Bazarr profile 2. All downloaded Chinese text passes the same strict script check. Existing scores and embedded-track policy are preserved. |

`SUBHD_PINCHTAB_URL` and `SUBHD_PINCHTAB_PROFILE` supply browser bootstrap.
`SUBHD_PINCHTAB_TOKEN` comes from the shared 1Password item mirrored into media.
The token is never sent to SubHD or included in errors.

The provider participates in Bazarr's existing wanted-subtitle searches and
upgrades. It creates or resumes its dedicated profile on demand; no session-time
download or manual sidecar installation is part of this integration. On an empty
config volume the startup policy seeds a minimal private config owned by the
LinuxServer user; Bazarr fills its remaining defaults at first start. Existing
configuration errors fail startup instead of being replaced.

OpenCC is used only to classify subtitle text. The policy does not convert
Traditional Chinese or generate a translation. Text without enough unambiguous
Simplified evidence remains wanted for a later source.

Fixture verification uses the exact catalog-pinned Bazarr image and its vendor
libraries, with no network access:

```sh
bun run --cwd packages/homelab/src/cdk8s test:bazarr
```

This requires a running Docker engine. CDK integration tests run in the ordinary
CDK8s test task. Production download and Plex playback are separate acceptance
checks; fixture success does not establish either.

The repeatable live smoke command uses the same provider in that pinned image.
It accepts an actual video's release basename and episode identity, runs at
least twice with fresh provider objects, and prints only identity, matches,
content size, and hash. It never writes subtitle files. Supply a local browser
endpoint reachable from Docker and an existing PinchTab bootstrap config:

```sh
bun run --cwd packages/homelab/src/cdk8s test:bazarr:live \
  --browser-url "$SUBTITLE_SMOKE_BROWSER_URL" \
  --browser-config "$PINCHTAB_CONFIG" \
  --series "$SUBTITLE_SMOKE_SERIES" --season "$SUBTITLE_SMOKE_SEASON" \
  --episode "$SUBTITLE_SMOKE_EPISODE" --release "$SUBTITLE_SMOKE_RELEASE"
```

An existing `PINCHTAB_TOKEN` environment credential takes precedence over the
config token, matching PinchTab's CLI. Neither is printed or saved by the runner.

Use the dedicated `subtitle-provider-smoke` profile for this validation. Add
`--restart-browser` to stop that test profile between runs and verify recovery.
Interactive challenges and source failures make the command fail; a passing
search alone does not count as a successful smoke test.

`typings/` declares the consumed Bazarr 1.6.0 vendor interfaces for the repository
Python checker; `utils.pyi` describes the neighboring vendor utility module.
These files are type-only contracts and are not mounted into Bazarr. Runtime
fixtures use the native implementations, not substitute classes.
