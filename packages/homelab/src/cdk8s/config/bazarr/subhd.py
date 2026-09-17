"""Original Simplified subtitles from SubHD; browser sessions stay in PinchTab.

Mounted into Bazarr's provider directory. Search/detail/CDN use HTTP; download
authorization runs in a persistent, dedicated browser profile. Interactive
challenges fail with a provider throttle and require human intervention.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
import time
import zipfile
from collections.abc import Iterable
from typing import ClassVar, TypedDict
from urllib.parse import quote, urlsplit

import rarfile
from guessit import guessit
from requests import Response
from requests import Session as HttpSession
from requests.exceptions import RequestException
from subliminal.exceptions import ConfigurationError
from subliminal.providers import ParserBeautifulSoup
from subliminal.subtitle import fix_line_ending
from subliminal.video import Episode, Video
from subliminal_patch.exceptions import APIThrottled
from subliminal_patch.providers import Provider
from subliminal_patch.subtitle import Subtitle, guess_matches
from subzero.language import Language

logger = logging.getLogger(__name__)
SIMPLIFIED = Language("zho", "CN")
CHINESE = Language("zho")
FORMATS = (".srt", ".ass", ".ssa")
MAX_DOWNLOAD = 32 * 1024 * 1024
MAX_SUBTITLE = 4 * 1024 * 1024
MAX_MEMBERS = 200
LOCK = threading.RLock()
last_request = 0.0
AI_LABEL = re.compile(
    r"(?<![a-z])AI(?![a-z])|机器翻译|機器翻譯|机翻|機翻|自动翻译|自動翻譯|ChatGPT|DeepL|Whisper", re.I
)
AI_CREDIT = re.compile(
    r"机器翻译|機器翻譯|机翻|機翻|"
    r"(?:\bAI\b|ChatGPT|DeepL|Whisper).{0,24}(?:翻译|翻譯|校对|校對|润色|潤色|translat|transcrib|proofread)|"
    r"(?:翻译|翻譯|校对|校對|润色|潤色|translat|transcrib|proofread).{0,24}(?:\bAI\b|ChatGPT|DeepL|Whisper)",
    re.I,
)
SIMPLIFIED_NAME = re.compile(r"简体|簡體|简英|(?<![a-z])(?:chs|zh[._-]?cn|gb|sc)(?![a-z])", re.I)
TRADITIONAL_NAME = re.compile(r"繁体|繁體|繁英|(?<![a-z])(?:cht|zh[._-]?tw|big5)(?![a-z])", re.I)
ENGLISH_NAME = re.compile(r"(?<![a-z])(?:eng|english|en)(?![a-z])", re.I)
EPISODE = re.compile(r"(?i)(?:s(\d{1,2})[ ._-]*e(\d{1,3})|(\d{1,2})x(\d{1,3}))(?!\d)")


class Candidate(TypedDict):
    sid: str
    version: str
    provenance: int
    bilingual: bool
    only_simplified: bool


def episode_numbers(name: str) -> set[tuple[int, int]]:
    numbers = {(int(a or c), int(b or d)) for a, b, c, d in EPISODE.findall(name)}
    # Compact ranges and chained E markers are not single-episode members.
    ranges = re.findall(r"(?i)(?:s(\d{1,2})e(\d{1,3})|(\d{1,2})x(\d{1,3}))(?:[._ ]*e|-e?)(\d{1,3})(?!\d|p\b)", name)
    numbers.update((int(a or c), int(end)) for a, _, c, _, end in ranges)
    return numbers


def is_season_pack(name: str, season: int) -> bool:
    return not episode_numbers(name) and bool(re.search(rf"(?i)s{season:02d}(?!\d)", name))


def pick_archive_member(
    names: Iterable[str], season: int, episode: int, release: str = "", explicit_simplified: bool = False
) -> str:
    """Never substitute another episode or use archive order as a tiebreaker."""
    candidates = []
    for name in names:
        if name.startswith("__MACOSX/") or os.path.basename(name).startswith("."):
            continue
        if not name.lower().endswith(FORMATS) or AI_LABEL.search(name):
            continue
        if episode_numbers(name) != {(season, episode)}:
            continue
        if TRADITIONAL_NAME.search(name) and not SIMPLIFIED_NAME.search(name):
            continue
        simplified = bool(SIMPLIFIED_NAME.search(name))
        if not simplified and (not explicit_simplified or ENGLISH_NAME.search(name)):
            continue
        # Match the video's release group before preferring bilingual content.
        group = re.search(r"-([a-z0-9]+)(?:\[.*)?$", release, re.I)
        group_match = bool(group and re.search(r"(?i)(?<![a-z0-9])" + re.escape(group[1]) + r"(?![a-z0-9])", name))
        bilingual = bool(re.search(r"中英|简英|chs[.&_-]+eng|双语", name, re.I))
        candidates.append(((group_match, simplified, bilingual), name))
    if not candidates:
        raise APIThrottled("subhd: no unambiguous Simplified subtitle for the requested episode")
    candidates.sort(reverse=True)
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        raise APIThrottled("subhd: ambiguous archive members for the requested episode")
    return candidates[0][1]


def validate_cdn_url(value: object) -> str:
    if not isinstance(value, str):
        raise APIThrottled("subhd: invalid download response")
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname == "dl.subhd.me"
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
        )
    except ValueError:
        valid = False
    if not valid:
        raise APIThrottled("subhd: unexpected download host")
    return value


def validate_content(content: bytes) -> bytes:
    if not content or len(content) > MAX_SUBTITLE:
        raise APIThrottled("subhd: invalid subtitle size")
    text = None
    encodings = ("utf-16",) if content.startswith((b"\xff\xfe", b"\xfe\xff")) else ("utf-8-sig", "gb18030")
    for encoding in encodings:
        try:
            text = content.decode(encoding)
            break
        except UnicodeError:
            continue
    if text is None or not re.search(r"[\u4e00-\u9fff]", text):
        raise APIThrottled("subhd: subtitle has no Chinese text")
    if AI_CREDIT.search(text):
        # Conservative: an AI attribution or machine label keeps the gap wanted.
        raise APIThrottled("subhd: subtitle contains an AI or machine attribution")
    if "-->" not in text and not re.search(r"(?im)^Dialogue:", text):
        raise APIThrottled("subhd: response is not a timed text subtitle")
    return fix_line_ending(text.encode("utf-8"))


def extract_subtitle(content: bytes, season: int, episode: int, release: str, explicit_simplified: bool) -> bytes:
    if len(content) > MAX_DOWNLOAD:
        raise APIThrottled("subhd: download exceeds size limit")
    if content.startswith(b"PK"):
        archive = zipfile.ZipFile(io.BytesIO(content))
    elif content.startswith(b"Rar!"):
        archive = rarfile.RarFile(io.BytesIO(content))
    else:
        return validate_content(content)
    with archive:
        members = archive.infolist()
        if len(members) > MAX_MEMBERS or sum(m.file_size for m in members) > MAX_DOWNLOAD:
            raise APIThrottled("subhd: archive exceeds expansion limit")
        name = pick_archive_member(archive.namelist(), season, episode, release, explicit_simplified)
        member = archive.getinfo(name)
        if member.file_size > MAX_SUBTITLE:
            raise APIThrottled("subhd: subtitle exceeds size limit")
        with archive.open(member) as stream:
            return validate_content(stream.read(MAX_SUBTITLE + 1))


def parse_candidates(html: str) -> list[Candidate]:
    soup = ParserBeautifulSoup(html, ["lxml", "html.parser"])
    candidates: list[Candidate] = []
    for block in soup.select("div.bg-white"):
        link = block.select_one("a[href^='/a/']")
        version_node = block.select_one("div.view-text")
        if not link or not version_node:
            continue
        href = link.get("href")
        if not isinstance(href, str):
            continue
        sid = href.removeprefix("/a/")
        if not re.fullmatch(r"[A-Za-z0-9]+", sid):
            continue
        labels = {span.get_text(strip=True) for span in block.select("div.text-truncate span")}
        text = block.get_text(" ", strip=True)
        if AI_LABEL.search(text) or not labels.intersection({"简体", "簡體"}):
            continue
        if not labels.intersection({"SRT", "ASS", "SSA"}):
            continue
        provenance = 2 if "官方字幕" in text else 1 if "原创翻译" in text else 0
        # Unknown provenance is not assumed human-authored.
        if not any(label in text for label in ("官方字幕", "原创翻译", "其他来源")):
            continue
        candidates.append(
            {
                "sid": sid,
                "version": version_node.get_text(" ", strip=True),
                "provenance": provenance,
                "bilingual": "双语" in labels,
                "only_simplified": not labels.intersection({"繁体", "繁體"}),
            }
        )
    return candidates


class SubhdSubtitle(Subtitle):
    provider_name = "subhd"
    hash_verifiable = False

    def __init__(
        self, candidate: Candidate, release_info: str, video: Episode, language: Language = SIMPLIFIED
    ) -> None:
        super().__init__(language, page_link="https://subhd.tv/a/" + candidate["sid"])
        self.sid = candidate["sid"]
        self.release_info = release_info
        self.season = video.season
        self.episode = video.episode
        self.video_release = os.path.splitext(os.path.basename(video.name))[0]
        self.only_simplified = candidate["only_simplified"]
        self.pack = is_season_pack(candidate["version"], video.season)
        self.provenance = candidate["provenance"]
        self.bilingual = candidate["bilingual"]

    @property
    def id(self) -> str:
        return f"{self.sid}:{self.season:02d}:{self.episode:02d}"

    def get_matches(self, video: Video) -> set[str]:
        matches = guess_matches(video, guessit(self.release_info, {"type": "episode"}))
        # Season packs are candidates for the requested episode; download must
        # verify an exact member before assigning content.
        if self.pack and "season" in matches and "series" in matches:
            matches.add("episode")
        return matches


class SubhdProvider(Provider):
    # Bazarr profiles may use generic zh. Content must still be explicitly
    # Simplified; supporting generic zh does not admit Traditional results.
    languages: ClassVar[set[Language]] = {SIMPLIFIED, CHINESE}
    video_types = (Episode,)
    subtitle_class = SubhdSubtitle
    server_url = "https://subhd.tv"

    def __init__(self) -> None:
        self.session: HttpSession | None = None
        self.browser: HttpSession | None = None
        self.browser_url = os.environ.get("SUBHD_PINCHTAB_URL", "").rstrip("/")
        self.profile = os.environ.get("SUBHD_PINCHTAB_PROFILE", "subhd")

    def initialize(self) -> None:
        token = os.environ.get("SUBHD_PINCHTAB_TOKEN")
        if not self.browser_url or not token:
            raise ConfigurationError("subhd: PinchTab endpoint and token are required")
        self.session = HttpSession()
        self.session.headers.update({"User-Agent": "Mozilla/5.0", "Accept-Language": "zh-CN,zh;q=0.9"})
        # Never share the credential-bearing session with a public site.
        self.browser = HttpSession()
        self.browser.headers["Authorization"] = "Bearer " + token

    def terminate(self) -> None:
        for session in (self.session, self.browser):
            if session:
                session.close()

    def _pace(self) -> None:
        global last_request
        remaining = 2.0 - (time.monotonic() - last_request)
        if remaining > 0:
            time.sleep(remaining)
        last_request = time.monotonic()

    def metadata_request(self, path: str) -> Response:
        if self.session is None:
            raise RuntimeError("subhd: provider not initialized")
        with LOCK:
            self._pace()
            try:
                response = self.session.get(self.server_url + path, timeout=30)
                response.raise_for_status()
                return response
            except RequestException:
                raise APIThrottled("subhd: metadata request failed") from None

    def browser_request(self, method: str, path: str, body: dict[str, object] | None = None) -> object:
        if self.browser is None:
            raise RuntimeError("subhd: provider not initialized")
        try:
            response = self.browser.request(method, self.browser_url + path, json=body, timeout=45)
            response.raise_for_status()
            return response.json()
        except (RequestException, ValueError):
            # Response bodies and exception URLs can contain sensitive data.
            raise APIThrottled("subhd: browser request failed; inspect browser health or human handoff") from None

    def browser_instance(self) -> str:
        profiles = self.browser_request("GET", "/profiles")
        if not isinstance(profiles, list):
            raise APIThrottled("subhd: invalid profile response")
        profile = next((p for p in profiles if isinstance(p, dict) and p.get("name") == self.profile), None)
        if profile is None:
            profile = self.browser_request("POST", "/profiles", {"name": self.profile})
        if not isinstance(profile, dict) or not isinstance(profile.get("id"), str):
            raise APIThrottled("subhd: invalid profile identity")
        instances = self.browser_request("GET", "/instances")
        if not isinstance(instances, list):
            raise APIThrottled("subhd: invalid instance response")
        instance = next((i for i in instances if isinstance(i, dict) and i.get("profileId") == profile["id"]), None)
        if instance is None:
            instance = self.browser_request(
                "POST",
                "/profiles/" + quote(profile["id"], safe="") + "/start",
                {"headless": True, "securityPolicy": {"allowedDomains": ["subhd.tv", "www.subhd.tv"]}},
            )
        if not isinstance(instance, dict):
            raise APIThrottled("subhd: invalid browser identity")
        instance_id = instance.get("instanceId", instance.get("id"))
        if not isinstance(instance_id, str) or not instance_id:
            raise APIThrottled("subhd: invalid browser identity")
        for _ in range(15):
            instances = self.browser_request("GET", "/instances")
            if not isinstance(instances, list):
                raise APIThrottled("subhd: invalid instance response")
            state = next(
                (i.get("status") for i in instances if isinstance(i, dict) and i.get("id") == instance_id), None
            )
            if state == "running":
                return instance_id
            if state != "starting":
                raise APIThrottled("subhd: browser unavailable; restart the dedicated profile after inspection")
            time.sleep(2)
        raise APIThrottled("subhd: browser startup timed out")

    def list_subtitles(self, video: Video, languages: set[Language]) -> list[SubhdSubtitle]:
        if not self.languages.intersection(languages) or not isinstance(video, Episode):
            return []
        candidates = {}
        for keyword in (
            f"{video.series} S{video.season:02d}E{video.episode:02d}",
            f"{video.series} S{video.season:02d}",
            video.series,
        ):
            for candidate in parse_candidates(self.metadata_request("/search/" + quote(keyword, safe="")).text):
                numbers = episode_numbers(candidate["version"])
                if numbers == {(video.season, video.episode)} or is_season_pack(candidate["version"], video.season):
                    candidates[candidate["sid"]] = candidate
        subtitles = []
        ranked = sorted(candidates.values(), key=lambda c: (c["provenance"], c["bilingual"]), reverse=True)
        for candidate in ranked[:8]:
            html = self.metadata_request("/a/" + candidate["sid"]).text
            soup = ParserBeautifulSoup(html, ["lxml", "html.parser"])
            # Detail-page AI labels also veto a seemingly acceptable search card.
            detail = soup.select_one("div.view-text")
            if detail and AI_LABEL.search(detail.get_text(" ", strip=True)):
                continue
            releases = [
                line.strip()
                for line in soup.get_text("\n", strip=True).splitlines()
                if re.search(r"(?i)(1080p|720p|2160p|web|bluray|hdtv)", line) and "." in line and " " not in line
            ]
            # A detail page can list unrelated filename tokens. Rank only
            # names that match this series/season; a complete search-card
            # release is often better than a member of a season pack.
            releases.append(candidate["version"])
            valid_releases = []
            for name in releases:
                matches = guess_matches(video, guessit(name, {"type": "episode"}))
                numbers = episode_numbers(name)
                if {"series", "season"}.issubset(matches) and (
                    not numbers or numbers == {(video.season, video.episode)}
                ):
                    valid_releases.append((len(matches), name))
            if not valid_releases:
                continue
            release = max(valid_releases)[1]
            language = SIMPLIFIED if SIMPLIFIED in languages else CHINESE
            subtitle = SubhdSubtitle(candidate, release, video, language)
            if {"series", "season", "episode"}.issubset(subtitle.get_matches(video)):
                subtitles.append(subtitle)
        return sorted(
            subtitles, key=lambda s: ("release_group" in s.get_matches(video), s.provenance, s.bilingual), reverse=True
        )

    def _wait_page(self, tab: str, path: str, prepare: bool = False) -> None:
        for _ in range(12):
            state = self.browser_request(
                "POST",
                "/tabs/" + tab + "/evaluate",
                {
                    "expression": "({ready:document.readyState,"
                    "challenge:!!document.querySelector('#challenge-running,iframe[src*=challenges]')"
                    "||/Just a moment|下载页面已失效/.test(document.title),path:location.pathname,"
                    "prepare:!!document.querySelector('.subtitle-prepare-download')&&!!window.jQuery})"
                },
            )
            result = state.get("result") if isinstance(state, dict) else None
            if (
                isinstance(result, dict)
                and result.get("ready") == "complete"
                and result.get("path") == path
                and result.get("challenge") is False
                and (not prepare or result.get("prepare") is True)
            ):
                return
            time.sleep(2)
        raise APIThrottled("subhd: download page unavailable or browser challenge requires human intervention")

    def authorize_download(self, subtitle: SubhdSubtitle) -> str:
        instance = self.browser_instance()
        opened = self.browser_request(
            "POST",
            "/instances/" + quote(instance, safe="") + "/tabs/open",
            {"url": self.server_url + "/a/" + subtitle.sid},
        )
        if not isinstance(opened, dict) or not isinstance(opened.get("tabId"), str):
            raise APIThrottled("subhd: invalid browser tab response")
        tab = quote(opened["tabId"], safe="")
        try:
            self._wait_page(tab, "/a/" + subtitle.sid, prepare=True)
            self._pace()
            # This is the detail page's own prepare-download flow. The ticket
            # remains in the browser. Defer navigation briefly so the evaluate
            # response resolves before its JavaScript context is replaced.
            prepare_expression = (
                "(async()=>{const r=await fetch('/api/sub/prepare-download',{method:'POST',"
                "headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},"
                "body:JSON.stringify({sid:"
                + json.dumps(subtitle.sid)
                + "})});if(!r.ok)return {prepared:false};const p=await r.json();"
                "if(p.success!==true||typeof p.url!=='string')return {prepared:false};"
                "const target=new URL(p.url,location.origin);"
                "if(target.origin!==location.origin||target.pathname!=="
                + json.dumps("/down/" + subtitle.sid)
                + ")return {prepared:false};setTimeout(()=>location.assign(target.href),100);return {prepared:true}})()"
            )
            prepared = self.browser_request(
                "POST", "/tabs/" + tab + "/evaluate", {"expression": prepare_expression, "awaitPromise": True}
            )
            result = prepared.get("result") if isinstance(prepared, dict) else None
            if not isinstance(result, dict) or result.get("prepared") is not True:
                raise APIThrottled("subhd: download preparation failed; source may be unavailable")
            self._wait_page(tab, "/down/" + subtitle.sid)
            self._pace()
            expression = (
                "(async()=>{const r=await fetch('/api/sub/down',{method:'POST',"
                "headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:"
                + json.dumps(subtitle.sid)
                + "})});if(!r.ok)return {success:false};return await r.json()})()"
            )
            payload = self.browser_request(
                "POST", "/tabs/" + tab + "/evaluate", {"expression": expression, "awaitPromise": True}
            )
            result = payload.get("result") if isinstance(payload, dict) else None
            if not isinstance(result, dict) or result.get("success") is not True:
                raise APIThrottled("subhd: download authorization failed; human intervention may be required")
            return validate_cdn_url(result.get("url"))
        finally:
            # Cleanup errors are visible, but must not reveal response bodies.
            try:
                self.browser_request("POST", "/tabs/" + tab + "/close", {})
            except APIThrottled:
                logger.warning("subhd: browser tab cleanup failed")

    def download_subtitle(self, subtitle: SubhdSubtitle) -> None:
        if self.session is None:
            raise RuntimeError("subhd: provider not initialized")
        with LOCK:
            self._pace()
            url = self.authorize_download(subtitle)
            self._pace()
            try:
                # Validate each redirect before issuing a request. No arbitrary
                # hosts, auth headers, exported browser cookies, or large bodies.
                for _ in range(3):
                    with self.session.get(url, timeout=30, stream=True, allow_redirects=False) as response:
                        if response.is_redirect:
                            url = validate_cdn_url(response.headers.get("Location"))
                            continue
                        response.raise_for_status()
                        data = bytearray()
                        for chunk in response.iter_content(64 * 1024):
                            data.extend(chunk)
                            if len(data) > MAX_DOWNLOAD:
                                raise APIThrottled("subhd: download exceeds size limit")
                        if subtitle.pack and not (data.startswith(b"PK") or data.startswith(b"Rar!")):
                            raise APIThrottled("subhd: season pack did not contain an archive")
                        subtitle.content = extract_subtitle(
                            bytes(data),
                            subtitle.season,
                            subtitle.episode,
                            subtitle.video_release,
                            subtitle.only_simplified,
                        )
                        return
                raise APIThrottled("subhd: too many download redirects")
            except (RequestException, zipfile.BadZipFile, rarfile.Error, NotImplementedError, RuntimeError):
                raise APIThrottled("subhd: subtitle download or archive failed") from None
