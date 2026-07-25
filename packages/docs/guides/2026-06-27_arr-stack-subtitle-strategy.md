---
id: guide-2026-06-27-arr-stack-subtitle-strategy
type: guide
status: complete
board: false
---

# \*arr Stack Subtitle Strategy (Bazarr): Forced-EN, EN, EN+Simplified-Chinese, Simplified-Chinese

## Status Notes (Historical)

Reference — research complete (2026-06-27)

> Provenance: deep-research (4 parallel investigators + adversarial review against Bazarr source code).
> Rendered `.typ`/`.pdf` copies live at `~/.claude-extra/research/arr-stack-subtitles.{typ,pdf}` (not committed — docs are Markdown-only).
> Applied to this homelab in plan [`plans/2026-06-27_bazarr-subtitles-chinese-gating.md`](../plans/2026-06-27_bazarr-subtitles-chinese-gating.md)
> and diagnostic log [`logs/2026-06-27_bazarr-whisper-subtitles-research.md`](../logs/2026-06-27_bazarr-whisper-subtitles-research.md) (live config + coverage numbers).

_Research report — June 2026. Target stack: Bazarr (current v1.5.x line) + Sonarr/Radarr, with a McCloud `bazarr-openai-whisperbridge → Groq` Whisper fallback, serving Plex and Jellyfin. Budget is not a constraint (paid tiers in scope)._

## Summary

Bazarr is the right tool, but the four targets are **not equally achievable**, and that asymmetry should drive your config:

- **Full English** is the easy, solved case — a handful of reliable providers (OpenSubtitles.com + Gestdown + Subdl + SubSource/subf2m + YIFY) cover almost everything, with Whisper-via-Groq as a genuine last-resort generator.
- **Simplified Chinese** is functional but operationally fragile. Bazarr ships only two Chinese-specialist providers — **assrt** and **zimuku** — and both have problems in 2025–2026: assrt's download hosts are currently unresolvable worldwide (the exact failure your homelab is logging), and zimuku needs a **funded anti-captcha.com balance** to clear challenges. OpenSubtitles.com is the reliable-but-shallow fallback. **Since you're willing to pay, this case improves a lot** (see "If budget is no object").
- **English + Simplified Chinese (bilingual)** is, paradoxically, often the _easiest_ Chinese case — but **not** via a special language. The Chinese fansub ecosystem distributes **bilingual (双语) `.ass` files by default**, and assrt/zimuku are coded to detect and prefer them. So selecting plain **Chinese (Simplified)** frequently yields a CN+EN file for free. Bazarr cannot split or merge bilingual files itself, and **Plex displays only one subtitle track at a time** (Jellyfin/mpv can show two).
- **Forced English** is the hardest. Online providers almost never carry forced subs reliably; the only dependable source is **extracting the embedded forced track** from your media — and even that works only when the file's track carries the actual `forced` _disposition flag_, not just a "Forced" title.

The single most impactful configuration choice is modeling the targets in **one language profile with multiple rows** (the same-language multi-row capability works in current Bazarr) and tuning **minimum scores** so Whisper-generated subs are accepted only where you want them.

## Findings

### 1. Provider landscape & reliability

Neither the Bazarr wiki nor TRaSH ranks providers — both only advise "enable several and make accounts" [5] [6]. Rankings below come from Bazarr's GitHub source/issues and r/bazarr field reports.

**English provider reliability (2025–2026):**

| Provider              | Cost / account                                  | Reliability                 | Notes                                                                               |
| --------------------- | ----------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| **OpenSubtitles.com** | Free acct (~20 dl/day\*); VIP = 1000/day (paid) | Backbone, but cap-throttles | Modern REST API Bazarr uses; recurring false "limit reached" bugs even for VIP [16] |
| **Gestdown**          | Free, no account                                | Good                        | Addic7ed proxy — best free English TV, no captcha [27]                              |
| **Subdl**             | Free                                            | Good                        | Subscene successor, generalist; some matching bugs [12]                             |
| **SubSource**         | Free                                            | Good                        | Active Subscene successor; native Bazarr provider (`subsource.py`)                  |
| **subf2m.co**         | Free, no download limits                        | Good                        | Subscene successor, huge catalog                                                    |
| **YIFY Subtitles**    | Free                                            | Good for movies             | Community data: top English _movie_ source [28]                                     |
| **Podnapisi**         | Free                                            | Flaky (ConnectionError)     | Supplementary only [28]                                                             |
| **Embedded**          | Free, local                                     | Perfect sync                | Not a network provider; see §5                                                      |
| **Addic7ed (direct)** | Account                                         | Cloudflare/captcha-prone    | Use **Gestdown** instead                                                            |
| **OpenSubtitles.org** | VIP-only                                        | N/A for new setups          | Legacy XML-RPC; non-VIP API shut down end-2023 [17]                                 |
| **Subscene**          | —                                               | **DEAD**                    | Permanent shutdown May 2024 [26]; no `subscene.py` in current tree                  |

\*Free-tier daily cap widely reported as ~20/day but the live API docs were Cloudflare-gated — re-confirm.

**Anime note:** if you run anime (a primary CN+EN dual-sub use case), Bazarr also ships **AnimeTosho** (`animetosho.py`) and **Jimaku** (`jimaku.py`, fansub-focused). Enable these for anime libraries — they often carry the bilingual fansub `.ass` releases the general providers miss.

**Simplified Chinese provider reliability (2025–2026):**

| Provider                    | In Bazarr?            | Cost                                      | Reliability                     | Notes                                                                                                                    |
| --------------------------- | --------------------- | ----------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **assrt**                   | ✅ native             | Free token                                | **Search OK / download broken** | Matcher rejects valid subs (#2761, reopened Jan 2026); download hosts currently unresolvable (see below) [12] [18]       |
| **zimuku**                  | ✅ native             | anti-captcha.com credit (when challenged) | Best catalog, ops painful       | Consumes anti-captcha only when a captcha is presented, not every request; generic-captcha refactor landed Jun 2026 [13] |
| **OpenSubtitles.com**       | ✅                    | Free/VIP                                  | Reliable but shallow for CJK    | Maps Chinese as `zh→zh-CN` only                                                                                          |
| **Subdl / SubSource**       | ✅                    | Free                                      | Secondary fallback              | Generalists; incidental Chinese coverage                                                                                 |
| **subhd**                   | ❌ **not a provider** | —                                         | —                               | Rejected — slider+image captcha Bazarr can't solve; only a featureupvote request [11-CN]                                 |
| **subf2m / Supersubtitles** | ✅ / ✅               | Free                                      | Weak/irrelevant for zh          | Supersubtitles is Hungarian-focused                                                                                      |

**The assrt DNS failure — root-caused (this homelab's exact symptom), as of June 2026:**

- `assrt.net` and `api.assrt.net` resolve fine; `api.assrt.net` → a stable US host (VegasNAP, Las Vegas), so **search works**.
- But the **download hosts** `file0/1/2.assrt.net` are all CNAMEs to **`glb.assrt.net`** (a DNSPod/Tencent GSLB), and at the time of this research `glb.assrt.net` **returned no A record from any public resolver** — verified against local, Google `8.8.8.8`, Cloudflare `1.1.1.1`, AliDNS `223.5.5.5`, and DNSPod `119.29.29.29`. `curl https://file1.assrt.net/` → HTTP `000`.
- **Conclusion:** the `Failed to resolve 'file1.assrt.net'` errors are a **real, assrt-side infrastructure fault**, not the homelab. Because it's a GSLB symptom it is **intermittent and time-bound** (it may resolve on its own), and there is no reliable US-side fix. It is _not_ GFW (which blocks inbound-to-China, not US→China). assrt even publishes an alt API domain `api.makedie.me` "due to network reasons" [18].

### 2. Forced subtitles — the hard truth

- **Definition:** forced subs appear only for foreign/alien dialogue or on-screen signs while the main audio is already your language (Dothraki in GoT, etc.) — distinct from **Normal** (full dialogue) and **HI** (adds sound-effect/speaker cues) [3].
- **Per-language profile setting** has three values: **False** = normal only; **True** = forced only ("forced subs aren't available in every language and are hard to find"); **Both** = normal + forced [1].
- **Providers rarely serve forced subs reliably.** Bazarr advertises forced support for 184 languages "depending on providers," but in practice no single online provider is dependable for forced [1] [9].
- **Embedded extraction is the only reliable route.** Bazarr's Embedded Subtitles provider uses the `fese` library → **ffprobe** to read each track's `disposition.forced` / `disposition.hearing_impaired` flags, then extracts via ffmpeg [8].
- **The gotcha:** ffprobe only classifies a track as forced if the container's **`forced` disposition bit** is actually set. A track merely _titled_ "Forced"/"SDH" without the bit will **not** be picked as forced. So forced-EN success depends entirely on how your releases were muxed.
- **Naming/pickup:** Bazarr writes sidecars like `Movie (Year).en.forced.srt`; Plex and Jellyfin both honor the `.forced` convention and auto-enable forced even when audio is your language [5].

### 3. Language profiles & scoring

- **A profile** is an ordered list of language rows; each row carries **Forced / HI / Exclude-Audio** toggles plus an optional **Cutoff** (stop once this language is satisfied) [2].
- **One profile can hold the same language twice with different settings.** The old bug blocking independent forced toggles on a second English row was reported on 0.9.4 (#1398) and is resolved in the current v1.x line — so forced-EN + full-EN + zh-Hans can all live in one profile as separate rows.
- **Scoring (verified against `score.py` source) [7]:** episodes are scored out of **360**, movies out of **120** (hash match = +359/+119 overrides everything). The percentage Bazarr shows uses these `score_without_hash` denominators. **(The often-quoted "180" movie denominator is stale — it is 120.)**
- **Minimum Score** is a percentage, set per-instance under Settings → Sonarr (episodes) and Settings → Radarr (movies) — it's the download gate [1]. TRaSH defaults: **Sonarr 90 / Radarr 80**, with sync thresholds 96/86 [6].
- **Whisper subs carry a fixed low score** so they only auto-download if you lower the minimum below it. Computed from Whisper's `get_matches` against the real score tables:
  - **Episodes:** series + season + episode = 180+30+30 = **240/360 ≈ 67%**.
  - **Movies:** title = 60/120 = **50%**.
  - So at TRaSH defaults (90/80) Whisper is **excluded**. To auto-accept Whisper, drop the episode minimum below ~67% and the movie minimum **below ~50%** (not the 33% the outdated wiki implies). Trade-off: lower scores also admit more mismatched/out-of-sync subs [6] [7].

### 4. Bilingual English + Simplified Chinese (中英双语)

- **Native bilingual is the dominant form and usually the best path — obtained through the ordinary Simplified-Chinese channel, not a special language.** Chinese fansub releases ship as bilingual (双语/简英/简体&英文) `.ass`/`.ssa` files, and **assrt and zimuku are coded to detect/prefer these and treat them as the requested Chinese language** [11] [13]. So selecting plain **Chinese (Simplified)** frequently yields a CN+EN file with zero extra work.
- **There is no selectable "Chinese bilingual" language in Bazarr.** OpenSubtitles' bilingual pseudo-language is code `ze` (not `zhe`), but Bazarr's OpenSubtitles.com provider maps Chinese only as `zh→zh-CN` and has no bilingual entry; Bazarr's language tables don't expose "Chinese Bilingual" at all (it's an explicitly-commented-out, empty-coded entry in the converter). **Do not try to add a `zhe`/`ze` profile row — it won't work.** Bilingual comes from the `zh` channel.
- **Bazarr cannot merge or split** dual-language subs (one file per language by design); the "Dual Language subtitle support" feature request is long-open [13-bil]. To _assemble_ a bilingual file from two singles, do it externally — **dualsub**, **merge-srt-subtitles**, or Subtitle Edit's "Append" — ideally wired into Bazarr's **custom post-processing** hook to run automatically [21].
- **Player support determines whether you even need a merged file:**
  - **mpv** — shows two tracks at once (`--sid` + `--secondary-sid`, with `--sub-pos` to separate) [22].
  - **Jellyfin** — has a **"Secondary Subtitle"** option (web/Android web; not when casting to Chromecast) [23].
  - **Plex** — **one subtitle track at a time, by design** — no secondary-subtitle feature [24]. **Plex users need a single native-bilingual or pre-merged file.**

### 5. Embedded subtitle extraction

- **"Use Embedded Subtitles" (setting)** makes Bazarr count in-container tracks (via ffprobe) when deciding if a language is "missing." The separate **Embedded Subtitles _provider_** actually extracts a track to a sidecar `.srt` [8].
- **Trade-off:** TRaSH/YAMS advise turning embedded _off_ if you'd rather Bazarr always fetch external files (otherwise it sees embedded and skips downloading) [30].
- **Hard limits:** PGS/VOBSUB are **image-based** (bitmaps) — unusable as text without OCR; use the **"Ignore Embedded PGS Subtitles"** toggle [15]. Embedded **`.ass` gets downgraded to `.srt`** on extraction (styling/positioning lost — relevant for bilingual ASS), and there are open reports of incomplete extraction [15].

### 6. Whisper as a fallback

- **Whisper can only translate _into English_** — confirmed by the Bazarr wiki: it transcribes many languages but "can only translate a language into English" [4]. Consequences per target:
  - **EN from English audio** → ✅ transcribe.
  - **EN from Chinese audio** → ✅ translate (CN→EN) — the one cross-lingual trick.
  - **Chinese from English audio** → ❌ **impossible** — Whisper cannot translate _into_ Chinese; must come from a provider.
  - **Chinese from Chinese audio** → ✅ transcribe (~13% character error rate for stock large-v3 — usable, not broadcast-quality; Simplified/Traditional output is non-deterministic, normalize with OpenCC) [20] [29].
- **Whisper can never produce forced-only subs** — it transcribes all speech, so it cannot substitute for a forced track.
- **Two ways to run Whisper with Bazarr:**
  1. **Your Groq bridge** (McCloud `bazarr-openai-whisperbridge`) — cheap, fast, no local GPU. To do CN→EN translation on Groq you must set `WHISPER_TRANSLATE_MODEL=whisper-large-v3` because `whisper-large-v3-turbo` 400s on the translate task (per bridge README) [19].
  2. **Self-hosted `onerahmet/openai-whisper-asr-webservice`** — the standard Bazarr Whisper backend, runs locally and avoids the Groq turbo-translate issue. **But this homelab has only Intel iGPU (i915), no NVIDIA** — Whisper large-v3 on CPU/Intel is slow, so the Groq bridge is the better fit unless you add a GPU. Listed for completeness.
- The bridge's `/detect-language` just returns a forced default, so enable Bazarr's **"Deep analyze media file to get audio tracks language"** so Chinese audio is labeled correctly [4] [19].

> **Machine-translation note (added after research):** Bazarr's built-in Google-translate is **manual-only** by
> design and cannot auto-fill gaps. Automated EN→zh machine translation requires a separate service —
> **[Lingarr](https://github.com/lingarr-translate/lingarr)** (integrates with Sonarr/Radarr; engines incl. Gemini/DeepL/OpenAI).
> Quality with an LLM engine is **B-grade — watchable, weaker on idioms/names**; benchmarks warn top models may emit
> Simplified for both zh-CN/zh-TW and that automated metrics overstate quality. Native bilingual `.ass` from
> zimuku/assrt (human fansubs) remains strictly better, so MT is best treated as a _last-resort tail filler_, not a primary source.

## Recommended setup for this stack

**Providers to enable in Bazarr:**

1. **OpenSubtitles.com** — primary for EN, fallback for zh. (Get **VIP**, see below.)
2. **Gestdown + Subdl + SubSource + subf2m + YIFY** — free English coverage (TV + movies); add **AnimeTosho + Jimaku** if you have anime.
3. **assrt** — enable (free token), best-effort: search works, downloads currently fail via the `glb.assrt.net` fault. Costs nothing to leave on.
4. **zimuku** — best Simplified catalog; fund an **anti-captcha.com** balance so it can clear challenges.
5. **Embedded Subtitles** — enable specifically to get **forced English** out of your `.mkv`s.
6. **Whisper** (Groq bridge) — last-resort generator; set `WHISPER_MODEL=whisper-large-v3-turbo` and `WHISPER_TRANSLATE_MODEL=whisper-large-v3`.

**One language profile, three rows:**

| Row | Language             | Forced   | HI    | Purpose                              | Realistic source                                              |
| --- | -------------------- | -------- | ----- | ------------------------------------ | ------------------------------------------------------------- |
| 1   | English              | **True** | off   | Forced English                       | **Embedded extraction** (online providers rarely have it)     |
| 2   | English              | False    | off\* | Full English                         | OpenSubtitles/Gestdown/Subdl/SubSource/YIFY; Whisper fallback |
| 3   | Chinese (Simplified) | False    | off   | Simplified Chinese **and** bilingual | assrt/zimuku/OS — often arrives as bilingual `.ass`           |

\*set HI=on only if you want SDH. Leave Cutoff unset if you want all rows always; set it to "Full English" if Chinese is merely nice-to-have. **Do not add a 4th "bilingual" row — bilingual comes through Row 3.**

- **Scores:** start at TRaSH (Sonarr 90 / Radarr 80). To let Whisper fill gaps, drop the episode minimum below ~67% and the movie minimum below ~50%.
- **Players:** keep subtitles **Alongside Media File**. On **Plex**, prefer the **native bilingual `.ass`** file (Plex won't show two tracks at once). On **Jellyfin/mpv**, you can instead load EN + zh as two separate tracks via secondary-subtitle support.
- **Simplified vs Traditional naming:** Bazarr writes Simplified as **`.zh`** and Traditional as **`.zt`**. Note `.zt` does **not** start with `zh`, so Plex/Jellyfin may mis-detect Traditional — prefer Simplified, and if you keep both, verify your player tags them correctly. There is no `zh-CN`/Mandarin code — select "Chinese (Simplified)" [14] [11].
- **Avoid "Single Language" mode** — it strips the language code from the sidecar filename (e.g. `Movie.srt` instead of `Movie.zh.srt`), which breaks Plex/Jellyfin language detection in a multi-language setup [14]. Keep normal (coded) filenames.
- **Automatic subtitle sync** (ffsubsync/alass) — Chinese fansub `.ass` files are frequently desynced; Bazarr's sync (TRaSH thresholds 96/86) materially improves them [6]. (Already enabled on this stack.)

### If budget is no object

- **OpenSubtitles.com VIP (~$/yr → 1000 downloads/day).** Removes the painful ~20/day free cap and cap-throttling. Worth it on any sizeable library; also re-grants OpenSubtitles.org access if you import a legacy VIP. **Do this.** [17]
- **Fund anti-captcha.com (~$10 goes a long way).** This is what makes **zimuku** — the best Simplified-Chinese catalog — actually return results. The single highest-leverage paid item for the Chinese targets. [13]
- **Keep Groq for Whisper** — it's ~$0.04/hr (cheaper than OpenAI's $0.36/hr `whisper-1` and a newer v3 model). A local GPU for self-hosted Whisper is _not_ worth it given Groq's price/speed unless you want fully-offline operation.
- **Net effect:** with VIP + funded anti-captcha, realistic coverage becomes English ≈ complete; Simplified-Chinese / bilingual ≈ good (zimuku primary + OS VIP + assrt when up); forced-English still embedded-only (money can't fix that); Whisper as the cheap catch-all.

## Per-target playbook

1. **Forced English** → Enable the **Embedded Subtitles** provider; rely on it extracting tracks whose `forced` _disposition bit_ is set. Online forced subs are unreliable; Whisper cannot help. Money can't fix this — it's about how your files were muxed.
2. **Full English** → OpenSubtitles.com (VIP) + Gestdown + Subdl + SubSource + subf2m + YIFY covers ~everything; Whisper-via-Groq generates the rest. Essentially solved.
3. **English + Simplified Chinese** → Select **Chinese (Simplified)** and enable assrt/zimuku, which default to bilingual `.ass`. No special "bilingual" language exists. Only merge externally if you must, and only **Plex** _requires_ a merged single file.
4. **Simplified Chinese (pure)** → zimuku (with funded anti-captcha) as primary + OpenSubtitles.com (VIP) + assrt (best-effort). Expect many results to actually be bilingual. Whisper only helps if the **audio itself is Chinese**; otherwise machine-translate (Lingarr) is the only automated path, at MT quality.

## Key takeaways

- **English is solved; Chinese is fragile but pay-fixable.** Difficulty: full-EN (easy) < EN+zh-bilingual (often free via `.ass` on the `zh` channel) < pure zh-Hans (provider-dependent) < forced-EN (embedded-only).
- **The assrt failure is real and external** (the `glb.assrt.net` GSLB) — leave it enabled but never depend on it; it may recover on its own.
- **Fund anti-captcha to unlock zimuku** — the single best paid lever for Chinese.
- **Bilingual is the `zh` channel, not a special language** — don't chase a `zhe`/`ze` row.
- **Forced-EN ≈ embedded extraction**, gated on the forced disposition bit — no reliable online or paid path.
- **Whisper is one-directional** (→English only) and **can't do forced** — fallback for English subs and Chinese-audio→Chinese subs only. Groq is the right backend for a GPU-less homelab.
- **Plex is the limiting factor** for on-screen dual subs; if dual subs matter, prefer Jellyfin/mpv or pre-merged files.
- **Per-user gating** (a specific Seerr user → Chinese) is possible via Seerr "Tag Requests" → Radarr/Sonarr tag → Bazarr "Tag-Based Automatic Language Profile Selection" (see the plan doc).

## Open questions

- **OpenSubtitles.com free-tier exact daily cap** — widely reported ~20/day but the live API docs were Cloudflare-gated; moot if you go VIP.
- **assrt `glb.assrt.net` recovery** — the DNS fault is transient by nature; re-test periodically.
- **zimuku post-Jun-2026 captcha refactor** — whether the new generic-captcha path enables a free local-OCR option (`ddddocr`, proposed but unconfirmed) instead of paid anti-captcha.

## Methodology & limitations

Four parallel investigators covered English providers; Simplified Chinese providers; forced subtitles + profiles/scoring; and bilingual/embedded/Whisper. An adversarial reviewer then cross-checked load-bearing claims **against Bazarr's actual source code** (`score.py`, `custom_lang.py`, `opensubtitlescom.py`, `whisperai.py`, `zimuku.py`, the providers directory) and corrected several errors from the (self-described-outdated) Bazarr wiki — notably the bilingual-language overreach, the `.zh`/`.zt` output naming, and the Whisper score floors (recomputed to ~67%/50%). The assrt DNS fault was reproduced with live `dig`/`curl` against five resolvers but is inherently time-bound. ~40 sources were consulted. Limitations: several `featureupvote.com` pages and the OpenSubtitles REST API docs are Cloudflare/JS-gated (confirmed at title/search level only); provider reliability is time-varying and partly community-reported; exact Bazarr UI widget names may drift between releases.

## Sources

1. Bazarr Wiki — Settings (forced, HI, embedded, anti-captcha, performance): https://wiki.bazarr.media/Additional-Configuration/Settings/
2. Bazarr Wiki — Setup Guide (language profiles, cutoff, defaults, providers): https://wiki.bazarr.media/Getting-Started/Setup-Guide/
3. Bazarr Wiki — FAQ (forced/embedded definitions): https://wiki.bazarr.media/Troubleshooting/FAQ/
4. Bazarr Wiki — Whisper Provider (translate=English-only): https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/
5. Bazarr Wiki — Plex / Jellyfin integration: https://wiki.bazarr.media/Additional-Configuration/Plex/ , https://wiki.bazarr.media/Additional-Configuration/Jellyfin/
6. TRaSH Guides — Bazarr setup + suggested scoring (90/80/96/86): https://trash-guides.info/Bazarr/ , https://trash-guides.info/Bazarr/Bazarr-suggested-scoring/
7. Bazarr source — `score.py` (point tables, 360/120 maxima): https://github.com/morpheus65535/bazarr/blob/master/custom_libs/subliminal_patch/score.py
8. Bazarr source — `providers/embeddedsubtitles.py` (fese/ffprobe forced disposition): https://github.com/morpheus65535/bazarr/blob/master/custom_libs/subliminal_patch/providers/embeddedsubtitles.py
9. Bazarr GitHub README (provider list; .org VIP-only; 184 languages): https://github.com/morpheus65535/bazarr
10. Bazarr source — `languages/custom_lang.py` (`.zh`/`.zt` output, custom languages): https://github.com/morpheus65535/bazarr/blob/master/bazarr/languages/custom_lang.py
11. Bazarr issue #1267 — Simplified/Traditional handling, assrt/zimuku prefer bilingual ASS: https://github.com/morpheus65535/bazarr/issues/1267
12. Bazarr issue #2761 — assrt matching bug (reopened Jan 2026): https://github.com/morpheus65535/bazarr/issues/2761
13. Bazarr issues #2106 / #2832 / #3372 — zimuku captcha + anti-captcha (refactored Jun 2026): https://github.com/morpheus65535/bazarr/issues/2106 , https://github.com/morpheus65535/bazarr/issues/2832 , https://github.com/morpheus65535/bazarr/issues/3372
14. Bazarr issue #935 — no zh-CN/Mandarin ISO code; Single-Language filename caveat: https://github.com/morpheus65535/bazarr/issues/935
15. Bazarr issues #2911 / #2514 / #406 — embedded extraction caveats (incomplete, ASS→SRT, ignore PGS): https://github.com/morpheus65535/bazarr/issues/2911 , https://github.com/morpheus65535/bazarr/issues/2514 , https://github.com/morpheus65535/bazarr/issues/406
16. Bazarr issue #2179 — OpenSubtitles VIP 1000/day cap + false-limit throttling: https://github.com/morpheus65535/bazarr/issues/2179
17. OpenSubtitles — user levels (VIP 1000/day): https://opensubtitles.tawk.help/article/user-levels-basic-vip ; .org API goodbye: https://blog.opensubtitles.com/opensubtitles/saying-goodbye-to-opensubtitles-org-api-embrace-the-20-black-friday-treat
18. assrt API docs (token, 20 req/min, bilingual 双语, makedie.me fallback): https://assrt.net/api/doc
19. McCloudS/bazarr-openai-whisperbridge README (translate-model, phantom filters): https://github.com/McCloudS/bazarr-openai-whisperbridge
20. Groq Docs — whisper-large-v3 (specs/WER): https://console.groq.com/docs/model/whisper-large-v3
21. dualsub: https://github.com/bonigarcia/dualsub ; merge-srt-subtitles: https://github.com/malfroid/merge-srt-subtitles
22. mpv #350 (secondary-sid dual subs): https://github.com/mpv-player/mpv/issues/350
23. Jellyfin secondary subtitle: https://features.jellyfin.org/posts/936/multi-language-subtitles , https://github.com/jellyfin/jellyfin/issues/12113
24. Plex forum — one subtitle track at a time: https://forums.plex.tv/t/bug-shows-two-subtitles-at-the-same-time/844193
25. OpenSubtitles.com language list (`ze` = Chinese bilingual, `zh-cn`/`zh-tw`): https://github.com/opensubtitles/VLSub-OpenSubtitles-com/blob/master/docs/languages.md
26. AlternativeTo — Subscene shutdown May 2024: https://alternativeto.net/news/2024/5/popular-subtitles-platform-subscene-announces-sudden-shutdown-leaving-users-in-shock/
27. Gestdown (Addic7ed proxy): https://www.aaflalo.me/2022/05/gestdown-addic7ed-proxy/
28. r/bazarr field reports: https://old.reddit.com/r/bazarr/comments/1oalfbb/which_ones_should_you_have/ , https://old.reddit.com/r/bazarr/comments/1hzla1x/best_free_subtitles_provider_to_use_with_bazarr/
29. whisper Simplified/Traditional + hallucination discussions: https://github.com/openai/whisper/discussions/277 , https://github.com/openai/whisper/discussions/1873
30. YAMS — Bazarr config (disable embedded to force external): https://yams.media/config/bazarr/
31. Lingarr (automated subtitle translation; Sonarr/Radarr integration, Gemini/DeepL/OpenAI engines): https://github.com/lingarr-translate/lingarr
