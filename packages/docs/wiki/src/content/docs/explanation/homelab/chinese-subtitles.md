---
title: About human Chinese subtitles
description: Why the subtitle pipeline favors original Simplified text, precise episode matching, and persistent browser sessions.
---

The Chinese subtitle pipeline favors human-authored Simplified text while keeping the existing video files.

Embedded tracks satisfy subtitle availability without requiring sidecar files.
A perfect file match establishes compatibility, but does not prove authorship or translation quality.
The [Bazarr deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/torrents/bazarr.ts)
preserves the application's embedded-track policy and adds provider overlays for external subtitles.

## Source labels and script

SubHD's official and original-translation labels offer useful provenance signals.
Other sources remain candidates because useful human translations may have been reuploaded.
AI and machine labels exclude a candidate, including AI proofreading and polishing.
These labels are claims, so newly downloaded files still need quality review.

A bilingual label does not establish Simplified Chinese.
The provider requires an explicit Simplified label and rejects an explicitly Traditional archive member.
It performs no script conversion or generated translation.
The [startup policy in the Bazarr deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/torrents/bazarr.ts)
also excludes OpenSubtitles AI and machine translations.

## Season packs and timing

A season pack can contain several episodes, scripts, and release variants.
Choosing its first file can silently install subtitles for a different episode.
The overlays retain the requested episode through download and require an exact archive member.
Release compatibility takes priority over bilingual presentation.
Ambiguous choices leave the subtitle wanted.

These checks establish file identity, rather than timing accuracy.
New subtitles still need playback review at the beginning, middle, and end of the episode.

## Browser authorization

SubHD's download flow depends on a recently prepared browser page.
Search and metadata remain ordinary HTTP requests.
A dedicated persistent browser profile performs download preparation and authorization.
Only a validated CDN URL leaves the browser; its cookies and preparation ticket stay inside Chrome.

The [PinchTab deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/pinchtab/index.ts)
retains its browser firewall and checks that Chrome is running before reporting readiness.
The [browser network policy](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/cdk8s-charts/pinchtab.ts)
permits Bazarr as an explicit consumer.
Interactive challenges and source failures throttle the provider and leave the gap wanted.
There is no automated CAPTCHA solver.
