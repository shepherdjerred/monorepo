"""Exercise the deployed provider contract repeatedly without writing subtitles."""

import argparse
import hashlib
import json
from typing import TYPE_CHECKING
from urllib.parse import quote

from subliminal.video import Episode
from subliminal_patch.exceptions import APIThrottled
from subliminal_patch.score import MAX_SCORES, compute_score
from subzero.language import Language

if TYPE_CHECKING:
    from .subhd import SubhdProvider, episode_numbers
else:
    from subliminal_patch.providers.subhd import SubhdProvider, episode_numbers


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True)
    parser.add_argument("--series", required=True)
    parser.add_argument("--season", required=True, type=int)
    parser.add_argument("--episode", required=True, type=int)
    parser.add_argument("--runs", type=int, choices=range(2, 6), default=2)
    parser.add_argument("--restart-browser", action="store_true")
    args = parser.parse_args()
    if args.season < 0 or args.episode < 1:
        parser.error("season must be nonnegative and episode must be positive")
    if episode_numbers(args.release) != {(args.season, args.episode)}:
        parser.error("release must identify exactly the requested episode")
    video = Episode.fromname(args.release)
    video.series = args.series
    # A fresh provider per run exercises process-local initialization while the
    # persistent browser profile survives. Never print CDN URLs or page bodies.
    for run in range(1, args.runs + 1):
        provider = SubhdProvider()
        if provider.profile != "subtitle-provider-smoke":
            raise SystemExit("subhd smoke: a dedicated test profile is required")
        try:
            provider.initialize()
            candidates = provider.list_subtitles(video, {Language("zho")})
            if not candidates:
                raise SystemExit("subhd smoke: no eligible Simplified candidates")
            candidate = candidates[0]
            matches = candidate.get_matches(video)
            raw_score, _ = compute_score(matches.copy(), candidate, video)
            score = round(raw_score / MAX_SCORES["episode"] * 100, 2)
            if score < 70:
                raise SystemExit("subhd smoke: best candidate is below the profile's minimum score")
            provider.download_subtitle(candidate)
            if not candidate.content:
                raise SystemExit("subhd smoke: provider returned no subtitle")
            print(
                json.dumps(
                    {
                        "run": run,
                        "provider": "subhd",
                        "candidate": candidate.sid,
                        "matches": sorted(matches),
                        "score": score,
                        "bytes": len(candidate.content),
                        "sha256": hashlib.sha256(candidate.content).hexdigest(),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            if args.restart_browser and run < args.runs:
                instance = provider.browser_instance()
                provider.browser_request("POST", "/instances/" + quote(instance, safe="") + "/stop", {})
        except APIThrottled as error:
            raise SystemExit(str(error)) from None
        finally:
            provider.terminate()


if __name__ == "__main__":
    main()
