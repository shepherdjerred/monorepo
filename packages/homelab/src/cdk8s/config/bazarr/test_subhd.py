"""Run in the pinned Bazarr image so fixtures exercise its real vendor APIs."""

import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import patch

import configure as policy
from requests.exceptions import HTTPError
from subliminal.video import Episode
from subzero.language import Language

if TYPE_CHECKING:
    from . import subhd, zimuku
else:
    from subliminal_patch.providers import subhd, zimuku
SRT = "1\n00:00:01,000 --> 00:00:03,000\n这是简体中文。\n".encode()


def card(
    sid: str = "JrBJEa",
    source: str = "官方字幕",
    languages: str = "简体",
    version: str = "The.Rehearsal.S01.1080p.WEB.H264",
    fmt: str = "SRT",
) -> str:
    badges = "".join("<span>" + badge + "</span>" for badge in [source, fmt, *languages.split()])
    return (
        '<div class="bg-white"><a href="/a/'
        + sid
        + '">彩排</a><div class="view-text">'
        + version
        + '</div><div class="text-truncate">'
        + badges
        + "</div></div>"
    )


def fixture_subtitle() -> subhd.SubhdSubtitle:
    video = Episode("The.Rehearsal.S01E03.1080p.WEB.h264-Cakes.mkv", "The Rehearsal", 1, 3)
    return subhd.SubhdSubtitle(subhd.parse_candidates(card(sid="sid"))[0], "The.Rehearsal.S01.1080p.WEB.H264", video)


class ParserTests(unittest.TestCase):
    def test_generic_zh_profile_and_no_wrong_episode_fallback(self) -> None:
        provider = subhd.SubhdProvider()
        html = card(version="The.Rehearsal.S01E03.1080p.WEB.h264-Cakes") + card(
            "wrong", version="The.Rehearsal.S01E04.1080p.WEB.h264-Cakes"
        )
        video = Episode("The.Rehearsal.S01E03.1080p.WEB.h264-Cakes.mkv", "The Rehearsal", 1, 3)
        with patch.object(provider, "metadata_request", return_value=SimpleNamespace(text=html)):
            subtitles = provider.list_subtitles(video, {Language("zho")})
        self.assertEqual([s.sid for s in subtitles], ["JrBJEa"])
        self.assertEqual(subtitles[0].language, Language("zho"))
        self.assertTrue({"series", "season", "episode"}.issubset(subtitles[0].get_matches(video)))

    def test_original_simplified_and_provenance(self) -> None:
        candidates = subhd.parse_candidates(card() + card("bilingual", "原创翻译", "双语 简体 英语"))
        self.assertEqual([c["sid"] for c in candidates], ["JrBJEa", "bilingual"])
        self.assertEqual(candidates[0]["provenance"], 2)
        self.assertTrue(candidates[1]["bilingual"])

    def test_no_script_inference_from_bilingual(self) -> None:
        self.assertEqual(subhd.parse_candidates(card(languages="双语 英语")), [])
        self.assertEqual(subhd.parse_candidates(card(languages="繁体")), [])

    def test_machine_categories_and_unknown_source(self) -> None:
        for source in ("AI校对", "AI翻译润色", "机器翻译", "未知来源"):
            with self.subTest(source=source):
                self.assertEqual(subhd.parse_candidates(card(source=source)), [])

    def test_unsupported_format(self) -> None:
        self.assertEqual(subhd.parse_candidates(card(fmt="SUP")), [])

    def test_episode_markers(self) -> None:
        self.assertEqual(subhd.episode_numbers("show.1x03.chs.srt"), {(1, 3)})
        self.assertFalse(subhd.is_season_pack("show.S01E04", 1))
        self.assertTrue(subhd.is_season_pack("show.S01.1080p.WEB", 1))


class ArchiveTests(unittest.TestCase):
    def test_renamed_video_keeps_refined_release_group_for_archive_selection(self) -> None:
        video = Episode.fromname("The.Rehearsal.S01E03.1080p.WEBRip.x265-RARBG.mp4")
        video.name = "The Rehearsal - S01E03 - Gold Digger WEBRip-1080p.mp4"
        subtitle = subhd.SubhdSubtitle(subhd.parse_candidates(card())[0], "The.Rehearsal.S01.1080p.WEB", video)
        names = ["show.S01E03-CAKES.chs.eng.ass", "show.S01E03-RARBG.chs.srt"]
        self.assertEqual(subhd.pick_archive_member(names, 1, 3, subtitle.video_release), names[1])
        provider = zimuku.ZimukuProvider()
        zimuku_subtitle = zimuku.ZimukuSubtitle(Language("zho"), "https://example.test/sub", "show.S01", None, None)
        with patch.object(provider, "query", return_value=[zimuku_subtitle]):
            self.assertEqual(provider.list_subtitles(video, {Language("zho")}), [zimuku_subtitle])
        self.assertEqual(zimuku_subtitle.target_release, subtitle.video_release)

    def test_exact_episode_and_simplified(self) -> None:
        names = ["show.S01E04.chs.srt", "show.S01E03.cht.eng.ass", "show.S01E03.eng.srt", "show.S01E03.chs.srt"]
        self.assertEqual(subhd.pick_archive_member(names, 1, 3), names[-1])

    def test_release_group_before_bilingual(self) -> None:
        names = ["show.S01E03-Cakes.chs.eng.ass", "show.S01E03-RARBG.chs.srt"]
        self.assertEqual(subhd.pick_archive_member(names, 1, 3, "show.S01E03-RARBG"), names[1])

    def test_missing_and_ambiguous_do_not_choose_first(self) -> None:
        for names in (
            ["show.S01E04.chs.srt"],
            ["show.S01E03-E04.chs.srt"],
            ["show.S01E03E04.chs.srt"],
            ["show.S01E03.srt"],
            ["a.S01E03.chs.srt", "b.S01E03.chs.srt"],
            ["show.chs.srt"],
        ):
            with self.subTest(names=names), self.assertRaises(subhd.APIThrottled):
                subhd.pick_archive_member(names, 1, 3)

    def test_metadata_allows_unmarked_chinese_but_not_english_member(self) -> None:
        self.assertEqual(
            subhd.pick_archive_member(["show.S01E03.srt"], 1, 3, explicit_simplified=True), "show.S01E03.srt"
        )
        with self.assertRaises(subhd.APIThrottled):
            subhd.pick_archive_member(["show.S01E03.eng.srt"], 1, 3, explicit_simplified=True)

    def test_pack_extracts_only_requested_episode(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("show.S01E04.chs.srt", SRT.replace("简体".encode(), "错误".encode()))
            archive.writestr("show.S01E03.chs.srt", SRT)
        self.assertEqual(subhd.extract_subtitle(buffer.getvalue(), 1, 3, "", False), subhd.validate_content(SRT))

    def test_expansion_limit(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("show.S01E03.chs.srt", b"x" * (subhd.MAX_SUBTITLE + 1))
        with self.assertRaises(subhd.APIThrottled):
            subhd.extract_subtitle(buffer.getvalue(), 1, 3, "", False)

    def test_content_must_be_chinese_timed_and_non_machine(self) -> None:
        for content in (
            b"<html>Error</html>",
            b"1\n00:00:01,000 --> 00:00:03,000\nEnglish only",
            SRT + "\n机器翻译\n".encode(),
        ):
            with self.subTest(content=content), self.assertRaises(subhd.APIThrottled):
                subhd.validate_content(content)
        # Ordinary English words containing 'ai' do not imply AI provenance.
        self.assertIn(b"said", subhd.validate_content(SRT + b"She said hello.\n"))


class BrowserTests(unittest.TestCase):
    def test_cold_start_and_restart_use_returned_instance_identity(self) -> None:
        for start_response in ({"instanceId": "new-instance"}, {"id": "new-instance"}):
            with self.subTest(start_response=start_response):
                provider = subhd.SubhdProvider()
                replies = [
                    [{"name": "subhd", "id": "profile"}],
                    [],
                    start_response,
                    [{"id": "new-instance", "profileId": "profile", "status": "starting"}],
                    [{"id": "new-instance", "profileId": "profile", "status": "running"}],
                ]
                with (
                    patch.object(provider, "browser_request", side_effect=replies) as api,
                    patch.object(subhd.time, "sleep"),
                ):
                    self.assertEqual(provider.browser_instance(), "new-instance")
                starts = [call for call in api.call_args_list if call.args[:2] == ("POST", "/profiles/profile/start")]
                self.assertEqual(len(starts), 1)

    def test_cdn_host_validation(self) -> None:
        self.assertEqual(subhd.validate_cdn_url("https://dl.subhd.me/a.srt"), "https://dl.subhd.me/a.srt")
        for value in (
            None,
            "http://dl.subhd.me/a",
            "https://dl.subhd.me.evil.test/a",
            "https://user:password@dl.subhd.me/a",
            "https://127.0.0.1/a",
            "https://dl.subhd.me:444/a",
            "https://dl.subhd.me:invalid/a",
        ):
            with self.subTest(value=value), self.assertRaises(subhd.APIThrottled):
                subhd.validate_cdn_url(value)

    def test_download_sequence_and_cookie_isolation(self) -> None:
        provider = subhd.SubhdProvider()
        calls = []
        prepared = False

        def api(method: str, path: str, body: dict[str, object] | None = None) -> object:
            nonlocal prepared
            calls.append((method, path, body))
            if path == "/profiles":
                return [{"name": "subhd", "id": "profile"}]
            if path == "/instances":
                return [{"profileId": "profile", "id": "instance", "status": "running"}]
            if path.endswith("/tabs/open"):
                return {"tabId": "tab"}
            if path.endswith("/evaluate"):
                assert body is not None
                expression = body["expression"]
                assert isinstance(expression, str)
                if body.get("awaitPromise"):
                    if "prepare-download" in expression:
                        prepared = True
                        return {"result": {"prepared": True}}
                    return {"result": {"success": True, "url": "https://dl.subhd.me/a.srt"}}
                return {
                    "result": {
                        "ready": "complete",
                        "path": "/down/sid" if prepared else "/a/sid",
                        "challenge": False,
                        "prepare": True,
                    }
                }
            if path.endswith("/close"):
                return {"closed": True}
            self.fail(path)

        provider.browser_request = api
        self.assertEqual(provider.authorize_download(fixture_subtitle()), "https://dl.subhd.me/a.srt")
        self.assertEqual(calls[-1][1], "/tabs/tab/close")
        expression = next(
            body["expression"]
            for _, _, body in calls
            if body and body.get("awaitPromise") and "prepare-download" not in body["expression"]
        )
        self.assertIn("fetch('/api/sub/down'", expression)
        self.assertFalse(any("cookie" in path for _, path, _ in calls))

    def test_challenge_never_calls_authorization_and_closes_tab(self) -> None:
        provider = subhd.SubhdProvider()
        provider.browser_instance = lambda: "instance"
        calls = []

        def api(method: str, path: str, body: dict[str, object] | None = None) -> object:
            calls.append(path)
            if path.endswith("/tabs/open"):
                return {"tabId": "tab"}
            if body and body.get("awaitPromise"):
                self.fail("must not submit while challenge is present")
            return {"result": {"ready": "complete", "path": "/down/sid", "challenge": True}}

        provider.browser_request = api
        with patch.object(subhd.time, "sleep"), self.assertRaises(subhd.APIThrottled):
            provider.authorize_download(fixture_subtitle())
        self.assertEqual(calls[-1], "/tabs/tab/close")

    def test_browser_errors_do_not_leak_secret_or_response(self) -> None:
        provider = subhd.SubhdProvider()
        provider.browser_url = "http://browser"
        browser = SimpleNamespace(
            request=lambda *args, **kwargs: (_ for _ in ()).throw(HTTPError("credential=secret download-url=private"))
        )
        with patch.object(provider, "browser", browser), self.assertRaises(subhd.APIThrottled) as error:
            provider.browser_request("GET", "/instances")
        self.assertNotIn("secret", str(error.exception))
        self.assertNotIn("private", str(error.exception))


class PolicyTests(unittest.TestCase):
    def test_legacy_config_is_not_overwritten_by_empty_volume_bootstrap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            legacy = path.with_suffix(".ini")
            legacy.write_text("[general]\nenabled_providers = ['embeddedsubtitles']\n")
            with self.assertRaises(ValueError):
                policy.configure(path)
            self.assertFalse(path.exists())
            self.assertIn("embeddedsubtitles", legacy.read_text())

    def test_empty_volume_bootstraps_policy_and_preserves_it_on_restart(self) -> None:
        import yaml

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config" / "config.yaml"
            policy.configure(path)
            first = path.read_text()
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(yaml.safe_load(first)["general"]["enabled_providers"], ["subhd"])
            policy.configure(path)
            self.assertEqual(path.read_text(), first)

    def test_corrupt_existing_configuration_is_not_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            path.write_text("general: invalid\n")
            with self.assertRaises(ValueError):
                policy.configure(path)
            self.assertEqual(path.read_text(), "general: invalid\n")

    def test_preserves_profiles_scores_and_credentials(self) -> None:
        import yaml

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            path.write_text(
                yaml.safe_dump(
                    {
                        "general": {
                            "enabled_providers": ["embeddedsubtitles", "assrt"],
                            "minimum_score": 70,
                            "use_embedded_subs": True,
                        },
                        "opensubtitlescom": {
                            "include_ai_translated": True,
                            "include_machine_translated": True,
                            "password": "fixture",
                        },
                    }
                )
            )
            policy.configure(path)
            first = path.read_text()
            policy.configure(path)
            self.assertEqual(path.read_text(), first)
            config = yaml.safe_load(first)
            self.assertEqual(
                config["general"],
                {"enabled_providers": ["embeddedsubtitles", "subhd"], "minimum_score": 70, "use_embedded_subs": True},
            )
            self.assertFalse(config["opensubtitlescom"]["include_ai_translated"])
            self.assertFalse(config["opensubtitlescom"]["include_machine_translated"])
            self.assertEqual(config["opensubtitlescom"]["password"], "fixture")


class ZimukuTests(unittest.TestCase):
    def test_direct_file_requires_original_simplified_and_exact_episode(self) -> None:
        for filename, explicit, accepted in [
            ("show.S01E03.chs.srt", True, True),
            ("show.S01E03.srt", False, False),
            ("show.S01E04.chs.srt", True, False),
            ("show.S01E03.cht.srt", True, False),
            ("show.S01.chs.srt", True, False),
        ]:
            with self.subTest(filename=filename):
                provider = zimuku.ZimukuProvider()
                responses = iter(
                    [
                        SimpleNamespace(content=b'<a id="down1" href="/download">download</a>'),
                        SimpleNamespace(content=b'<a rel="nofollow" href="/file">file</a>'),
                        SimpleNamespace(
                            content=SRT, headers={"Content-Disposition": filename}, raise_for_status=lambda: None
                        ),
                    ]
                )
                subtitle = zimuku.ZimukuSubtitle(Language("zho"), "https://example.test/sub", "show.S01", None, None)
                subtitle.target_season = 1
                subtitle.target_episode = 3
                subtitle.explicit_simplified = explicit
                with patch.object(provider, "yunsuo_bypass", side_effect=responses):
                    if accepted:
                        provider.download_subtitle(subtitle)
                        self.assertEqual(subtitle.content, subhd.validate_content(SRT))
                    else:
                        with self.assertRaises(subhd.APIThrottled):
                            provider.download_subtitle(subtitle)

    def test_mixed_archive_preserves_episode_and_script(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("show.S01E04.chs.eng.ass", b"wrong episode")
            archive.writestr("show.S01E03.cht.eng.ass", b"wrong script")
            archive.writestr("show.S01E03.chs.srt", SRT)
        subtitle = zimuku.ZimukuSubtitle(Language("zho"), "https://example.test/sub", "show.S01", None, None)
        subtitle.target_season = 1
        subtitle.target_episode = 3
        subtitle.target_release = "show.S01E03-RARBG"
        with zipfile.ZipFile(buffer) as archive:
            self.assertEqual(zimuku.subtitle_from_archive(archive, subtitle), SRT)

    def test_target_metadata_survives_provider_search(self) -> None:
        provider = zimuku.ZimukuProvider()
        subtitle = zimuku.ZimukuSubtitle(Language("zho"), "https://example.test/sub", "show.S01", None, None)
        provider.query = lambda *args, **kwargs: [subtitle]
        video = Episode("show.S01E03-RARBG.mkv", "show", 1, 3)
        self.assertEqual(provider.list_subtitles(video, {Language("zho")}), [subtitle])
        self.assertEqual((subtitle.target_season, subtitle.target_episode), (1, 3))


if __name__ == "__main__":
    unittest.main()
