# Bazarr 1.6.0 upstream, SHA256 before modifications:
# 52b0b5f5aaa5769cd11b7f84bbf3cb67d3846e3cc5c517c3b107458a1047b236
# Local changes: normalize search results, select exact episode archives, and
# validate Simplified content without exposing credential-bearing URLs.
import logging
import os
import re
from math import ceil
from time import sleep
from typing import ClassVar

from babelfish import language_converters
from guessit import guessit
from requests import Session
from requests.exceptions import JSONDecodeError, RequestException
from subliminal import Episode, Movie
from subliminal.exceptions import ConfigurationError, ProviderError
from subliminal_patch.providers import Provider
from subliminal_patch.subtitle import Subtitle, guess_matches
from subzero.language import Language

from .subhd import (
    AI_LABEL,
    ENGLISH_NAME,
    MAX_DOWNLOAD,
    SIMPLIFIED_NAME,
    TRADITIONAL_NAME,
    archive_release,
    episode_numbers,
    extract_subtitle,
    validate_content,
)

logger = logging.getLogger(__name__)

language_converters.register('assrt = subliminal_patch.converters.assrt:AssrtConverter')

server_url = 'https://api.assrt.net/v1'
supported_languages = list(language_converters['assrt'].to_assrt.keys())

meaningless_videoname = ['不知道']


def get_request_delay(max_request_per_minute):
    return ceil(60 / max_request_per_minute)


def language_contains(subset, superset):
    if subset.alpha3 != superset.alpha3:
        return False
    if superset.country is not None and subset.country != superset.country:
        return False
    return superset.script is None or subset.script == superset.script


def search_language_in_list(lang, langlist):
    for language in langlist:
        if language_contains(lang, language):
            return language
    return None


def check_status_code(resp):
    try:
        response = resp.json()
        if 'status' in response and 'errmsg' in response:
            raise ProviderError(f'{response["errmsg"]} ({response["status"]})')
    except JSONDecodeError:
        pass


def request(session, url, **kwargs):
    response = None
    try:
        response = session.get(url, **kwargs)
        if not kwargs.get('stream'):
            check_status_code(response)
        response.raise_for_status()
        return response
    except ProviderError:
        raise
    except RequestException:
        if kwargs.get('stream') and response is not None:
            response.close()
        raise ProviderError('ASSRT request failed') from None


def response_subtitles(response):
    try:
        result = response.json()
    except JSONDecodeError:
        raise ProviderError('ASSRT returned invalid subtitle JSON') from None
    block = result.get('sub') if isinstance(result, dict) else None
    subs = block.get('subs') if isinstance(block, dict) else None
    if not isinstance(subs, list) or any(not isinstance(sub, dict) for sub in subs):
        raise ProviderError('ASSRT returned invalid subtitle results')
    return subs


def fetch_detail(session, token, quota, subtitle_id):
    logger.info('Get subtitle detail: GET /sub/detail')
    sleep(get_request_delay(quota))
    response = request(session, server_url + '/sub/detail',
                       params={'token': token, 'id': subtitle_id}, timeout=15)
    subs = response_subtitles(response)
    if len(subs) != 1:
        raise ProviderError('ASSRT returned invalid subtitle details')
    if str(subs[0].get('id')) != str(subtitle_id):
        raise ProviderError('ASSRT returned details for a different subtitle')
    return subs[0]


def machine_labeled(sub):
    names = [sub.get(key) for key in ('videoname', 'native_name', 'title', 'sub_name',
                                     'm_title', 'm_videoname', 'm_extras', 'extras', 'm_source', 'source')]
    producer = sub.get('producer')
    if isinstance(producer, dict):
        names.append(producer.get('source'))
    return any(AI_LABEL.search(name) for value in names
               for name in (value if isinstance(value, list) else [value])
               if isinstance(name, str))


def release_matches(video, name):
    if name.lower().endswith(('.zip', '.rar')):
        name = os.path.splitext(name)[0]
        # Fansub attribution is appended to the release, not its release group.
        name = re.sub(r'\.@[^/]+$', '', name)
    matches = guess_matches(video, guessit(name))
    cleaned = re.sub(r'^[\u4e00-\u9fff]+[.\s]+', '', name)
    if cleaned != name:
        matches |= guess_matches(video, guessit(cleaned))
    return matches


class AssrtSubtitle(Subtitle):
    """Assrt Sbutitle."""
    provider_name = 'assrt'
    guessit_options: ClassVar[dict[str, object]] = {
        'allowed_languages': [lang[0] for lang in supported_languages],
        # 'allowed_countries': [ l[1] for l in supported_languages if len(l) > 1 ],
        'enforce_list': True
    }

    def __init__(self, language, subtitle_id, video_name, session, token, max_request_per_minute):
        super().__init__(language)
        self.session = session
        self.token = token
        self.max_request_per_minute = max_request_per_minute
        self.subtitle_id = subtitle_id
        self.video_name = video_name
        self.release_info = video_name
        self.url = None
        self.matches = set()
        self._detail = None
        self._target_season = None
        self._target_episode = None
        self._target_release = ''
        self._metadata = None

    def _get_detail(self):
        if self._detail:
            return self._detail
        sub = self._metadata
        if sub is None:
            sub = fetch_detail(self.session, self.token, self.max_request_per_minute, self.id)
            self._metadata = sub
        if machine_labeled(sub):
            return False
        if not len(sub['filelist']):
            # Single-file subtitle: URL is directly in the sub entry
            if sub.get('url'):
                self._detail = sub
                return sub
            logger.error('Can\'t get filelist from subtitle details')
            return False
        files = sub['filelist']

        # zero pass: for season packs, narrow down to files matching the
        # target episode before language selection, so the language passes
        # don't accidentally pick a file from the wrong episode.
        if self._target_episode is not None:
            episode_files = [
                f for f in files
                if isinstance(f, dict)
                and isinstance(f.get('f'), str)
                and not AI_LABEL.search(f['f'])
                and episode_numbers(f['f']) == {(self._target_season, self._target_episode)}
            ]
            if not episode_files:
                return False
            files = episode_files

        if self.language.alpha3 == 'zho' and self._target_episode is not None:
            explicit_simplified = bool(sub.get('lang', {}).get('langlist', {}).get('langchs'))
            candidates = []
            group = re.search(r'-([a-z0-9]+)(?:\[.*)?$', self._target_release, re.I)
            for f in files:
                name = f['f']
                if TRADITIONAL_NAME.search(name) and not SIMPLIFIED_NAME.search(name):
                    continue
                if not name.lower().endswith(('.srt', '.ass', '.ssa', '.zip', '.rar')):
                    continue
                simplified = bool(SIMPLIFIED_NAME.search(name))
                if not simplified and (not explicit_simplified or ENGLISH_NAME.search(name)):
                    continue
                group_match = bool(group and re.search(
                    r'(?i)(?<![a-z0-9])' + re.escape(group[1]) + r'(?![a-z0-9])', name))
                bilingual = bool(re.search(r'中英|简英|chs[.&_-]+eng|双语', name, re.I))
                candidates.append(((group_match, simplified, bilingual), f))
            candidates.sort(key=lambda candidate: candidate[0], reverse=True)
            if not candidates:
                return False
            if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
                raise ProviderError('ASSRT has ambiguous files for the requested episode')
            self._detail = candidates[0][1]
            return self._detail

        # first pass: guessit
        for f in files:
            guess = guessit(f['f'], self.guessit_options)
            langs = set()
            if 'language' in guess:
                langs.update(guess['language'])
            if 'subtitle_language' in guess:
                langs.update(guess['subtitle_language'])
            if self.language in langs:
                self._detail = f
                return f

        # second pass: keyword matching
        codes = language_converters['assrt'].codes
        for f in files:
            langs = set([Language.fromassrt(k) for k in codes if k in f['f']])
            if self.language in langs:
                self._detail = f
                return f

        return False

    @property
    def id(self):
        return self.subtitle_id

    @property
    def download_link(self):
        detail = self._get_detail()
        if not detail:
            return None
        return detail['url']

    def get_matches(self, video):
        if isinstance(video, Episode):
            if (self._target_season, self._target_episode) != (video.season, video.episode):
                self._detail = None
            self._target_season = video.season
            self._target_episode = video.episode
            self._target_release = archive_release(video)
        self.matches = release_matches(video, self.video_name) if self.video_name else set()
        if isinstance(video, Episode) and self.language.alpha3 == 'zho':
            detail = self._get_detail()
            if not detail:
                self.matches = set()
                return self.matches
            name = detail.get('f') or detail.get('filename') or self.video_name
            file_matches = release_matches(video, name) if name else set()
            if not {'series', 'season', 'episode'}.issubset(file_matches):
                self.matches = set()
                return self.matches
            self.matches = file_matches
            self.release_info = name
            return self.matches
        # Season pack handling: assrt often returns season packs (e.g.
        # "Rick.and.Morty.S06.1080p.BluRay.x264-STORiES") when searching for a
        # specific episode.  guessit won't extract an episode number from such a
        # name, so the subtitle gets skipped by Bazarr's "doesn't match our
        # series/episode" filter even though _get_detail will pick the correct
        # episode file from the pack's filelist at download time.
        if (isinstance(video, Episode) and "series" in self.matches
                and "season" in self.matches and "episode" not in self.matches):
            guess = guessit(self.video_name) if self.video_name else {}
            if "episode" not in guess:
                self.matches.add("episode")
        return self.matches


class AssrtProvider(Provider):
    """Assrt Provider."""
    languages: ClassVar[set[Language]] = {Language(*lang) for lang in supported_languages}
    video_types = (Episode, Movie)

    def __init__(self, token=None):
        if not token:
            raise ConfigurationError('Token must be specified')
        self.token = token
        self.session = Session()
        self.max_request_per_minute = None

    def initialize(self):
        self.session.headers = {'User-Agent': os.environ.get("SZ_USER_AGENT", "Sub-Zero/2")}
        res = request(self.session, server_url + '/user/quota', params={'token': self.token}, timeout=15)
        result = res.json()
        if 'user' in result and 'quota' in result['user']:
            self.max_request_per_minute = result['user']['quota']

        if not isinstance(self.max_request_per_minute, int):
            raise ProviderError('ASSRT returned an invalid request quota')

        if self.max_request_per_minute <= 0:
            raise ProviderError(f'User request quota is not a positive integer: {self.max_request_per_minute}')

    def terminate(self):
        self.session.close()

    def query(self, languages, video):
        # query the server
        keywords = []
        if isinstance(video, Movie):
            if video.title:
                # title = "".join(e for e in video.title if e.isalnum())
                title = video.title
                keywords.append(title)
            if video.year:
                keywords.append(str(video.year))
        elif isinstance(video, Episode):
            if video.series:
                # series = "".join(e for e in video.series if e.isalnum())
                series = video.series
                keywords.append(series)
            if video.season and video.episode:
                keywords.append(f'S{video.season:02d}E{video.episode:02d}')
            elif video.episode:
                keywords.append(f'E{video.episode:02d}')
        query = ' '.join(keywords)

        params = {'token': self.token, 'q': query, 'is_file': 1}
        logger.debug('Searching subtitles: GET /sub/search')
        sleep(get_request_delay(self.max_request_per_minute))
        res = request(self.session, server_url + '/sub/search', params=params, timeout=15)
        results = response_subtitles(res)

        # parse the subtitles
        pattern = re.compile(r'lang(?P<code>\w+)')
        subtitles = []
        for sub in results:
            if machine_labeled(sub):
                continue
            metadata = None
            if 'fileid' in sub and ('id' not in sub or 'lang' not in sub):
                subtitle_id = sub['fileid']
                if isinstance(subtitle_id, bool) or not str(subtitle_id).isdigit():
                    raise ProviderError('ASSRT returned an invalid search subtitle ID')
                metadata = fetch_detail(self.session, self.token, self.max_request_per_minute, subtitle_id)
                sub = metadata
            elif 'id' not in sub:
                raise ProviderError('ASSRT returned an unsupported search result')
            if machine_labeled(sub):
                continue
            if 'lang' not in sub:
                continue
            native_name = sub.get('native_name')
            candidate_names = [sub.get('videoname')]
            if isinstance(native_name, list):
                candidate_names.extend(native_name)
            else:
                candidate_names.append(native_name)
            if any(isinstance(name, str) and AI_LABEL.search(name) for name in candidate_names):
                continue
            for key in sub['lang']['langlist']:
                # "dou" describes bilingual subtitles; it is not a language.
                if key == 'langdou':
                    continue
                match = pattern.match(key)
                if match is None:
                    continue
                try:
                    language = Language.fromassrt(match.group('code'))
                    output_language = search_language_in_list(language, languages)
                    if output_language:
                        if sub.get('videoname') and sub['videoname'] not in meaningless_videoname:
                            video_name = sub['videoname']
                        elif 'native_name' in sub and isinstance(sub['native_name'], str):
                            video_name = sub['native_name']
                        elif ('native_name' in sub and isinstance(sub['native_name'], list) and
                              len(sub['native_name']) > 0):
                            video_name = sub['native_name'][0]
                        else:
                            video_name = None
                        subtitle = AssrtSubtitle(language=output_language,
                                                       subtitle_id=sub['id'],
                                                       video_name=video_name,
                                                       session=self.session,
                                                       token=self.token,
                                                       max_request_per_minute=self.max_request_per_minute)
                        subtitle._metadata = metadata
                        subtitles.append(subtitle)
                except (AttributeError, KeyError, ValueError):
                    pass

        return subtitles

    def list_subtitles(self, video, languages):
        return self.query(languages, video)

    def download_subtitle(self, subtitle):
        if not subtitle.download_link:
            logger.warning('No download link available for subtitle %s, skipping', subtitle.subtitle_id)
            subtitle.content = None
            return
        sleep(get_request_delay(self.max_request_per_minute))
        r = request(self.session, subtitle.download_link, timeout=15, stream=True)
        try:
            chunks = []
            size = 0
            for chunk in r.iter_content(chunk_size=65536):
                size += len(chunk)
                if size > MAX_DOWNLOAD:
                    raise ProviderError('ASSRT download exceeds size limit')
                chunks.append(chunk)
            content = b''.join(chunks)
        except RequestException:
            raise ProviderError('ASSRT download failed') from None
        finally:
            r.close()
        if subtitle.language.alpha3 == 'zho':
            if content.startswith((b'PK', b'Rar!')):
                if subtitle._target_season is None or subtitle._target_episode is None:
                    raise ProviderError('ASSRT archive download requires an episode target')
                subtitle.content = extract_subtitle(content, subtitle._target_season,
                                                    subtitle._target_episode, subtitle._target_release, False)
            else:
                subtitle.content = validate_content(content)
        else:
            subtitle.content = content
