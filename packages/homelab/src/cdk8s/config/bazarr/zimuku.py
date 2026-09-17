# Bazarr 1.6.0 upstream, SHA256 before modifications:
# 32f208a63d4fe986c3c36e24fa39f262b0155723f68bf5a60083a662d23aef54
# Local changes: preserve video/language when choosing archive members.
import base64
import copy
import io
import logging
import os
import re
import zipfile
from collections.abc import Callable, Mapping
from random import randint, randrange
from typing import ClassVar
from urllib.parse import unquote, urljoin

import rarfile
from babelfish import language_converters
from bs4 import BeautifulSoup, Tag
from guessit import guessit
from PIL import Image
from requests import Response, Session
from six import text_type
from subliminal.providers import ParserBeautifulSoup
from subliminal.subtitle import SUBTITLE_EXTENSIONS, fix_line_ending
from subliminal.video import Episode, Movie, Video
from subliminal_patch.exceptions import APIThrottled
from subliminal_patch.pitcher import pitchers
from subliminal_patch.providers import Provider
from subliminal_patch.subtitle import Subtitle, guess_matches
from subzero.language import Language

from .subhd import (
    AI_LABEL,
    MAX_DOWNLOAD,
    MAX_MEMBERS,
    MAX_SUBTITLE,
    SIMPLIFIED_NAME,
    TRADITIONAL_NAME,
    episode_numbers,
    pick_archive_member,
    validate_content,
)
from .utils import FIRST_THOUSAND_OR_SO_USER_AGENTS as AGENT_LIST

logger = logging.getLogger(__name__)

language_converters.register("zimuku = subliminal_patch.converters.zimuku:zimukuConverter")

supported_languages = list(language_converters["zimuku"].to_zimuku.keys())


def required_tag(document: BeautifulSoup | Tag, selector: str) -> Tag:
    tag = document.select_one(selector)
    if tag is None:
        raise APIThrottled("zimuku: source page markup changed")
    return tag


def required_attribute(tag: Tag, name: str) -> str:
    value = tag.get(name)
    if not isinstance(value, str):
        raise APIThrottled("zimuku: source page attribute changed")
    return value


class ZimukuSubtitle(Subtitle):
    """Zimuku Subtitle."""

    provider_name = "zimuku"

    def __init__(
        self, language: Language, page_link: str, version: str, session: Session | None, year: int | None
    ) -> None:
        super().__init__(language, page_link=page_link)
        self.version = version
        self.release_info = version
        self.hearing_impaired = False
        self.encoding = "utf-8"
        self.session = session
        self.year = year
        self.matches: set[str] = set()
        self.explicit_simplified = False
        self.target_season: int | None = None
        self.target_episode: int | None = None
        self.target_release = ""

    @property
    def id(self) -> str:
        return self.page_link

    def get_matches(self, video: Video) -> set[str]:
        if video.year == self.year:
            self.matches.add("year")

        # episode
        if isinstance(video, Episode):
            info = guessit(self.version, {"type": "episode"})
            # other properties
            self.matches |= guess_matches(video, info)

            # add year to matches if video doesn't have a year but series, season and episode are matched
            if not video.year and all(item in self.matches for item in ["series", "season", "episode"]):
                self.matches |= {"year"}
        # movie
        elif isinstance(video, Movie):
            # other properties
            self.matches |= guess_matches(video, guessit(self.version, {"type": "movie"}))

        return self.matches


def string_to_hex(s: str) -> str:
    val = ""
    for i in s:
        val += hex(ord(i))[2:]
    return val


class ZimukuProvider(Provider):
    """Zimuku Provider."""

    languages: ClassVar[set[Language]] = {Language(*language) for language in supported_languages}
    video_types = (Episode, Movie)
    logger.info(str(supported_languages))

    server_url = "https://srtku.com"
    search_url = "/search?q={}"

    subtitle_class = ZimukuSubtitle

    def __init__(self) -> None:
        self.session = Session()

    verify_token = ""
    code = ""
    location_re = re.compile(r'self\.location = "(.*)" \+ stringToHex\(')
    verification_image_re = re.compile(r'<img.*?src="data:image/bmp;base64,(.*?)".*?>')

    def yunsuo_bypass(self, url: str, *, headers: Mapping[str, str] | None = None, timeout: float = 30) -> Response:
        def parse_verification_image(image_content: str) -> str:

            def bmp_to_image(base64_str: str, img_type: str = "png") -> io.BytesIO:
                img_data = base64.b64decode(base64_str)
                img = Image.open(io.BytesIO(img_data))
                img = img.convert("RGB")
                img_fp = io.BytesIO()
                img.save(img_fp, img_type)
                img_fp.seek(0)
                return img_fp

            fp = bmp_to_image(image_content)
            anticaptcha_class = os.environ["ANTICAPTCHA_CLASS"]
            if anticaptcha_class == "AntiCaptchaProxyLess":
                image_pitcher = "AntiCaptchaImageToText"
            elif anticaptcha_class == "CaptchaAIProxyLess":
                image_pitcher = "CaptchaAIImageToText"
            else:
                image_pitcher = "DeathByCaptchaImageToText"
            pitcher = pitchers.get_pitcher(image_pitcher)("Zimuku", fp)
            return pitcher.throw()

        i = -1
        while True:
            i += 1
            r = self.session.get(url, headers=headers, timeout=timeout)
            if r.status_code == 404:
                # mock js script logic
                tr = self.location_re.findall(r.text)
                verification_image = self.verification_image_re.findall(r.text)
                if len(verification_image):
                    self.code = parse_verification_image(verification_image[0])
                else:
                    self.code = f"{randrange(800, 1920)},{randrange(600, 1080)}"
                self.session.cookies.set("srcurl", string_to_hex(r.url))
                if tr:
                    verify_resp = self.session.get(
                        urljoin(self.server_url, tr[0] + string_to_hex(self.code)), allow_redirects=False
                    )
                    if (
                        verify_resp.status_code == 302
                        and self.session.cookies.get("security_session_verify") is not None
                    ):
                        pass
                    continue
            if len(self.location_re.findall(r.text)) == 0:
                self.verify_token = string_to_hex(self.code)
                return r

    def initialize(self) -> None:
        self.session.close()
        self.session = Session()
        self.session.headers["User-Agent"] = AGENT_LIST[randint(0, len(AGENT_LIST) - 1)]

    def terminate(self) -> None:
        self.session.close()

    def _parse_episode_page(self, link: str, year: int | None) -> list[ZimukuSubtitle]:
        r = self.yunsuo_bypass(link)
        bs_obj = ParserBeautifulSoup(r.content.decode("utf-8", "ignore"), ["html.parser"])
        subs_body = required_tag(bs_obj, "tbody")
        subs = []
        for sub in subs_body.find_all("tr"):
            if AI_LABEL.search(sub.get_text(" ", strip=True)):
                continue
            a = required_tag(sub, "a")
            name = _extract_name(a.text)
            name = os.path.splitext(name)[0]  # remove ext because it can be an archive type

            language = Language("eng")
            language_list = []

            images = required_tag(sub, "td.tac.lang").select("img")
            for img in images:
                src = required_attribute(img, "src")
                if "china" in src and "hongkong" in src:
                    logger.debug("language:" + str(language))

                    language = Language("zho").add(Language("zho", "TW", None))
                    language_list.append(language)
                elif "china" in src or "jollyroger" in src:
                    logger.debug("language chinese simplified found: " + str(language))

                    language = Language("zho")
                    language_list.append(language)
                elif "hongkong" in src:
                    logger.debug("language chinese traditional found: " + str(language))

                    language = Language("zho", "TW", None)
                    language_list.append(language)
            sub_page_link = urljoin(self.server_url, required_attribute(a, "href"))
            backup_session = copy.deepcopy(self.session)
            backup_session.headers["Referer"] = link

            # Keep each advertised language as a separate candidate for the
            # archive's language-specific member.
            for language in language_list:
                subtitle = self.subtitle_class(language, sub_page_link, name, backup_session, year)
                subtitle.explicit_simplified = bool(SIMPLIFIED_NAME.search(a.text)) or any(
                    "china" in required_attribute(img, "src") and "hongkong" not in required_attribute(img, "src")
                    for img in images
                )
                subs.append(subtitle)

        return subs

    def query(
        self, keyword: str, season: int | None = None, episode: int | None = None, year: int | None = None
    ) -> list[ZimukuSubtitle]:
        params = keyword
        if season:
            params += f".S{season:02d}"
        elif year:
            params += f" {year:4d}"

        logger.debug("Searching subtitles %r", params)
        subtitles = []
        search_link = urljoin(self.server_url, text_type(self.search_url).format(params))

        r = self.yunsuo_bypass(search_link, timeout=30)
        r.raise_for_status()

        if not r.content:
            logger.debug("No data returned from provider")
            return []

        html = r.content.decode("utf-8", "ignore")
        # parse window location
        pattern = r"url\s*=\s*'([^']*)'\s*\+\s*url"
        parts = re.findall(pattern, html)
        redirect_url = search_link
        while parts:
            parts.reverse()
            redirect_url = urljoin(self.server_url, "".join(parts))
            r = self.session.get(redirect_url, timeout=30)
            html = r.content.decode("utf-8", "ignore")
            parts = re.findall(pattern, html)
        logger.debug("search url located: " + redirect_url)

        soup = ParserBeautifulSoup(r.content.decode("utf-8", "ignore"), ["lxml", "html.parser"])

        # non-shooter result page
        if soup.find("div", {"class": "item"}):
            logger.debug("enter a non-shooter page")
            for item in soup.find_all("div", {"class": "item"}):
                title_a = required_tag(item, "p.tt.clearfix a")
                subs_year = year
                if season:
                    # episode year in zimuku is the season's year not show's year
                    actual_subs_year = re.findall(r"\d{4}", title_a.text) or None
                    if actual_subs_year:
                        subs_year = int(actual_subs_year[0]) - season + 1
                    title = title_a.text
                    season_match = re.search("第(.*)季", title)
                    season_cn1 = "一" if season_match is None else season_match.group(1).strip()
                    season_cn2 = num_to_cn(str(season))
                    if season_cn1 != season_cn2:
                        continue
                episode_link = urljoin(self.server_url, required_attribute(title_a, "href"))
                new_subs = self._parse_episode_page(episode_link, subs_year)
                subtitles += new_subs

        # NOTE: shooter result pages are ignored due to the existence of zimuku provider

        return subtitles

    def list_subtitles(self, video: Video, languages: set[Language]) -> list[ZimukuSubtitle]:
        if isinstance(video, Episode):
            titles = [video.series, *video.alternative_series]
        elif isinstance(video, Movie):
            titles = [video.title, *video.alternative_titles]
        else:
            titles = []

        subtitles = []
        # query for subtitles with the show_id
        for title in titles:
            if isinstance(video, Episode):
                subtitles += [
                    s
                    for s in self.query(
                        title,
                        season=video.season,
                        episode=video.episode,
                        year=video.year,
                    )
                    if s.language in languages
                ]
            elif isinstance(video, Movie):
                subtitles += [s for s in self.query(title, year=video.year) if s.language in languages]

        for subtitle in subtitles:
            subtitle.target_season = video.season if isinstance(video, Episode) else None
            subtitle.target_episode = video.episode if isinstance(video, Episode) else None
            subtitle.target_release = os.path.splitext(os.path.basename(video.name))[0]
        return [s for s in subtitles if not AI_LABEL.search(s.release_info)]

    def download_subtitle(self, subtitle: ZimukuSubtitle) -> None:
        def _get_archive_download_link(yunsuopass: Callable[[str], Response], sub_page_link: str) -> str:
            res = yunsuopass(sub_page_link)
            bs_obj = ParserBeautifulSoup(res.content.decode("utf-8", "ignore"), ["html.parser"])
            down_page_link = required_attribute(required_tag(bs_obj, "a#down1"), "href")
            down_page_link = urljoin(sub_page_link, down_page_link)
            res = yunsuopass(down_page_link)
            bs_obj = ParserBeautifulSoup(res.content.decode("utf-8", "ignore"), ["html.parser"])
            return urljoin(sub_page_link, required_attribute(required_tag(bs_obj, "a[rel=nofollow]"), "href"))

        # download the subtitle
        logger.info("Downloading subtitle %r", subtitle)
        download_link = _get_archive_download_link(self.yunsuo_bypass, subtitle.page_link)
        r = self.yunsuo_bypass(download_link, headers={"Referer": subtitle.page_link}, timeout=30)
        r.raise_for_status()
        try:
            filename = r.headers["Content-Disposition"].lower()
        except KeyError:
            logger.debug("Unable to parse subtitles filename. Dropping this subtitles.")
            return

        if not r.content:
            logger.debug("Unable to download subtitle. No data returned from provider")
            return

        archive_stream = io.BytesIO(r.content)
        archive = None
        if rarfile.is_rarfile(archive_stream):
            logger.debug("Identified rar archive")
            if ".rar" not in filename:
                logger.debug(f".rar should be in the downloaded file name: {filename}")
                return
            archive = rarfile.RarFile(archive_stream)
            subtitle_content = subtitle_from_archive(archive, subtitle)
        elif zipfile.is_zipfile(archive_stream):
            logger.debug("Identified zip archive")
            if ".zip" not in filename:
                logger.debug(f".zip should be in the downloaded file name: {filename}")
                return
            archive = zipfile.ZipFile(archive_stream)
            subtitle_content = subtitle_from_archive(archive, subtitle)
        else:
            is_sub = ""
            for sub_ext in SUBTITLE_EXTENSIONS:
                if sub_ext in filename:
                    is_sub = sub_ext
                    break
            if not is_sub:
                logger.debug(f"unknown subtitle ext int downloaded file name: {filename}")
                return
            logger.debug(f"Identified {is_sub} file")
            if subtitle.language.alpha3 == "zho" and not (
                subtitle.language.country and subtitle.language.country.alpha2 == "TW"
            ):
                decoded_filename = unquote(filename)
                if TRADITIONAL_NAME.search(decoded_filename) and not SIMPLIFIED_NAME.search(decoded_filename):
                    raise APIThrottled("zimuku: direct file is explicitly Traditional")
                if not subtitle.explicit_simplified and not SIMPLIFIED_NAME.search(decoded_filename):
                    raise APIThrottled("zimuku: direct file has no explicit Simplified provenance")
                if subtitle.target_season is not None and episode_numbers(
                    decoded_filename + " " + subtitle.version
                ) != {(subtitle.target_season, subtitle.target_episode)}:
                    raise APIThrottled("zimuku: direct file does not identify the requested episode")
            subtitle_content = r.content

        if subtitle_content:
            if subtitle.language.alpha3 == "zho" and not (
                subtitle.language.country and subtitle.language.country.alpha2 == "TW"
            ):
                subtitle_content = validate_content(subtitle_content)
            subtitle.content = fix_line_ending(subtitle_content)
        else:
            logger.debug("Could not extract subtitle from %r", archive)


def subtitle_from_archive(archive: zipfile.ZipFile | rarfile.RarFile, subtitle: ZimukuSubtitle) -> bytes | None:
    if (
        subtitle.language.alpha3 == "zho"
        and not (subtitle.language.country and subtitle.language.country.alpha2 == "TW")
        and subtitle.target_season is not None
    ):
        members = archive.infolist()
        if subtitle.target_episode is None:
            raise ValueError("zimuku: episode metadata missing")
        if len(members) > MAX_MEMBERS or sum(m.file_size for m in members) > MAX_DOWNLOAD:
            raise ValueError("zimuku: archive exceeds expansion limit")
        name = pick_archive_member(
            archive.namelist(),
            subtitle.target_season,
            subtitle.target_episode,
            subtitle.target_release,
            explicit_simplified=False,
        )
        if archive.getinfo(name).file_size > MAX_SUBTITLE:
            raise ValueError("zimuku: subtitle exceeds size limit")
        with archive.open(name) as stream:
            return stream.read(MAX_SUBTITLE + 1)
    extract_subname, max_score = "", -1

    for subname in archive.namelist():
        # discard hidden files
        if os.path.split(subname)[-1].startswith("."):
            continue

        # discard non-subtitle files
        if not subname.lower().endswith(SUBTITLE_EXTENSIONS):
            continue

        # prefer ass/ssa/srt subtitles with double languages or simplified/traditional chinese
        score = ("ass" in subname or "ssa" in subname or "srt" in subname) * 1
        if "简体" in subname or "chs" in subname or ".gb." in subname:
            score += 2
        if "繁体" in subname or "cht" in subname or ".big5." in subname:
            score += 2
        if "chs.eng" in subname or "chs&eng" in subname or "cht.eng" in subname or "cht&eng" in subname:
            score += 2
        if (
            "中英" in subname
            or "简英" in subname
            or "繁英" in subname
            or "双语" in subname
            or "简体&英文" in subname
            or "繁体&英文" in subname
        ):
            score += 4
        logger.debug(f"subtitle {subname}, score: {score}")
        if score > max_score:
            max_score = score
            extract_subname = subname

    return archive.read(extract_subname) if max_score != -1 else None


def _extract_name(name: str) -> str:
    """filter out Chinese characters from subtitle names"""
    name, suffix = os.path.splitext(name)
    c_pattern = "[\u4e00-\u9fff]"
    e_pattern = "[a-zA-Z]"
    c_indices = [m.start(0) for m in re.finditer(c_pattern, name)]
    e_indices = [m.start(0) for m in re.finditer(e_pattern, name)]

    target, discard = e_indices, c_indices

    if len(target) == 0:
        return ""

    first_target, last_target = target[0], target[-1]
    first_discard = discard[0] if discard else -1
    last_discard = discard[-1] if discard else -1
    if last_discard < first_target:
        new_name = name[first_target:]
    elif last_target < first_discard:
        new_name = name[:first_discard]
    else:
        # try to find maximum continous part
        result, start, end = [0, 1], -1, 0
        while end < len(name):
            while end not in e_indices and end < len(name):
                end += 1
            if end == len(name):
                break
            start = end
            while end not in c_indices and end < len(name):
                end += 1
            if end - start > result[1] - result[0]:
                result = [start, end]
            start = end
            end += 1
        new_name = name[result[0] : result[1]]
    new_name = new_name.strip() + suffix
    return new_name


def num_to_cn(number: str) -> str:
    """convert numbers(1-99) to Chinese"""
    assert number.isdigit() and 1 <= int(number) <= 99

    trans_map = dict(zip("123456789", "一二三四五六七八九", strict=True))

    if len(number) == 1:
        return trans_map[number]
    else:
        part1 = "十" if number[0] == "1" else trans_map[number[0]] + "十"
        part2 = trans_map[number[1]] if number[1] != "0" else ""
        return part1 + part2
