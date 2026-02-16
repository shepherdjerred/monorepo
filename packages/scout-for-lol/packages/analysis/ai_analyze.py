#!/usr/bin/env -S uvx python
"""
Local chat-style profiler for Discord CSV exports.

Designed to feed an LLM (e.g., GPT-4o) a dense “style card” per user:
- Lexical: TF-IDF tokens, 3/4-gram phrases, char trigrams, type-token stats.
- Shape: word/char medians + tails, openers/closers, punctuation cadence + repeats.
- Voice: emoji/laughter, slang + hedges/intensifiers, hours active, stretch/shout habits.
- Formatting: links/mentions/quotes/code/multiline rates.
- Examples: representative message + top repeated quotes (multi-word by default).

Usage (from packages/analysis):
  ./ai_analyze.py --guild glitter-boys --top 5 --quotes-per-user 20 --min-quote-words 3
  ./ai_analyze.py --guild league-of-legends --format json > styles.json
  ./ai_analyze.py --all --focus-user "virmel"
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from datetime import datetime
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple

STOPWORDS = {
    "a",
    "about",
    "all",
    "am",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "get",
    "got",
    "had",
    "has",
    "have",
    "he",
    "her",
    "hers",
    "him",
    "his",
    "how",
    "i",
    "if",
    "ill",
    "im",
    "in",
    "is",
    "it",
    "its",
    "just",
    "like",
    "me",
    "mine",
    "my",
    "no",
    "not",
    "of",
    "off",
    "oh",
    "ok",
    "on",
    "or",
    "our",
    "out",
    "so",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "to",
    "too",
    "up",
    "was",
    "we",
    "well",
    "were",
    "what",
    "when",
    "where",
    "who",
    "why",
    "will",
    "with",
    "would",
    "ya",
    "yeah",
    "you",
    "your",
    "youre",
}

NOISE_TOKENS: Set[str] = {"missing"}

# Rough list of frequent English words to help flag likely typos (very lightweight).
COMMON_WORDS: Set[str] = {
    "about",
    "after",
    "again",
    "against",
    "almost",
    "along",
    "also",
    "always",
    "another",
    "around",
    "away",
    "back",
    "because",
    "before",
    "being",
    "between",
    "called",
    "could",
    "different",
    "during",
    "early",
    "enough",
    "even",
    "every",
    "family",
    "first",
    "found",
    "friend",
    "great",
    "group",
    "happy",
    "house",
    "important",
    "large",
    "later",
    "little",
    "long",
    "money",
    "morning",
    "mother",
    "never",
    "night",
    "nothing",
    "other",
    "place",
    "point",
    "power",
    "problem",
    "really",
    "right",
    "school",
    "small",
    "something",
    "sound",
    "state",
    "still",
    "story",
    "study",
    "thing",
    "think",
    "thought",
    "through",
    "under",
    "until",
    "water",
    "where",
    "while",
    "white",
    "woman",
    "world",
    "work",
    "year",
}

# Optional manual overrides for how author IDs should be displayed in output.
# Example: {"123456789012345678": "Alice"}
USER_ID_ALIASES: Dict[str, str] = {
    "186665676134547461": "Aaron",
    "208425244128444418": "Brian",
    "410595870380392458": "Irfan",
    "200067001035653131": "Ryan",
}


@dataclass
class Message:
    author_id: str
    author_name: str
    content: str
    is_bot: bool
    timestamp: datetime | None


def normalize_content(text: str) -> str:
    text = re.sub(r"https?://\S+", " ", text)
    text = text.replace("\u200b", " ")
    return text.strip()


def resolve_author_name(author_id: str, name: str) -> str:
    if author_id in USER_ID_ALIASES:
        return USER_ID_ALIASES[author_id]
    cleaned = name.strip()
    return cleaned or "Unknown"


def basic_words(text: str) -> List[str]:
    return [w for w in re.findall(r"[A-Za-z0-9']+", text) if w.lower() not in NOISE_TOKENS]


def tokenize(text: str) -> List[str]:
    lowered = text.lower()
    tokens = re.findall(r"[a-z0-9']+", lowered)
    return [
        t
        for t in tokens
        if 1 < len(t) <= 30
        and t not in NOISE_TOKENS
        and not is_numeric_id(t)
    ]


def ngrams(tokens: List[str], n: int) -> Iterable[str]:
    for i in range(len(tokens) - n + 1):
        yield " ".join(tokens[i : i + n])


def valid_ngram_tokens(tokens: List[str]) -> bool:
    # Skip phrases that are just repeated noise (e.g., "missing missing").
    return not (tokens and len(set(tokens)) == 1 and tokens[0] in NOISE_TOKENS)


def is_repetitive_phrase(tokens: List[str]) -> bool:
    if len(tokens) < 3:
        return False
    counts = Counter(tokens)
    max_share = max(counts.values()) / len(tokens)
    return max_share >= 0.5


def read_csv_messages(path: Path, include_bots: bool) -> Iterable[Message]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            return
        columns = {name: idx for idx, name in enumerate(header)}

        def col(name: str) -> int | None:
            return columns.get(name)

        for row in reader:
            content = row[col("content")] if col("content") is not None else ""
            if not content:
                continue
            ts_raw = (
                row[col("timestamp")]
                if col("timestamp") is not None
                else (row[col("date")] if col("date") is not None else "")
            )
            timestamp = None
            if ts_raw:
                try:
                    timestamp = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                except ValueError:
                    timestamp = None
            author_id = (
                row[col("author.id")] if col("author.id") is not None else "unknown"
            )
            raw_author_name = (
                row[col("author.global_name")]
                if col("author.global_name") is not None
                else None
            ) or (
                row[col("author.username")]
                if col("author.username") is not None
                else None
            ) or "Unknown"
            author_name = resolve_author_name(author_id, raw_author_name)
            bot_flag = (
                row[col("author.bot")] if col("author.bot") is not None else "false"
            )
            is_bot = bot_flag.strip().lower() == "true"
            if is_bot and not include_bots:
                continue
            yield Message(
                author_id=author_id,
                author_name=author_name,
                content=content,
                is_bot=is_bot,
                timestamp=timestamp,
            )


def walk_csvs(base_dir: Path, guild: str | None) -> List[Path]:
    root = base_dir if guild in (None, "all") else base_dir / guild
    return [p for p in root.rglob("*.csv") if p.is_file()]


def compute_tfidf(doc_tokens: Dict[str, Counter]) -> Dict[str, Dict[str, float]]:
    doc_count = len(doc_tokens)
    df = Counter()
    for counts in doc_tokens.values():
        df.update(counts.keys())

    tfidf: Dict[str, Dict[str, float]] = {}
    for doc_id, counts in doc_tokens.items():
        tfidf_doc: Dict[str, float] = {}
        max_tf = max(counts.values()) if counts else 1
        for token, tf in counts.items():
            idf = math.log((1 + doc_count) / (1 + df[token])) + 1.0
            tfidf_doc[token] = (tf / max_tf) * idf
        tfidf[doc_id] = tfidf_doc
    return tfidf


def cosine_similarity(vec_a: Dict[str, float], vec_b: Dict[str, float]) -> float:
    if not vec_a or not vec_b:
        return 0.0
    common = set(vec_a.keys()) & set(vec_b.keys())
    dot = sum(vec_a[k] * vec_b[k] for k in common)
    norm_a = math.sqrt(sum(v * v for v in vec_a.values()))
    norm_b = math.sqrt(sum(v * v for v in vec_b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def top_items(counter: Counter | Dict[str, float], limit: int) -> List[Tuple[str, float]]:
    return sorted(counter.items(), key=lambda kv: kv[1], reverse=True)[:limit]


def pick_representative_message(
    messages: List[str], weights: Dict[str, float]
) -> str | None:
    best = None
    best_score = 0.0
    for msg in messages:
        toks = tokenize(normalize_content(msg))
        if not toks:
            continue
        score = sum(weights.get(t, 0.0) for t in toks) / len(toks)
        if score > best_score:
            best_score = score
            best = msg
    return best


def score_messages(
    messages: List[str], weights: Dict[str, float], limit: int = 20
) -> List[Tuple[str, float]]:
    scored: List[Tuple[str, float]] = []
    seen: Set[str] = set()
    for msg in messages:
        normalized = normalize_content(msg)
        if normalized in seen:
            continue
        toks = tokenize(normalized)
        if len(toks) < 3:
            continue
        seen.add(normalized)
        score = sum(weights.get(t, 0.0) for t in toks) / len(toks)
        if score > 0:
            scored.append((msg, score))
    scored.sort(key=lambda kv: kv[1], reverse=True)
    return scored[:limit]


def extract_unicode_emoji(text: str) -> List[str]:
    # Basic plane coverage; avoids needing the `regex` module.
    emoji_ranges = (
        "\U0001F300-\U0001F5FF"
        "\U0001F600-\U0001F64F"
        "\U0001F680-\U0001F6FF"
        "\U0001F700-\U0001F77F"
        "\U0001F900-\U0001F9FF"
        "\U0001FA70-\U0001FAFF"
        "\U00002700-\U000027BF"
        "\U0001F1E6-\U0001F1FF"
    )
    pattern = f"[{emoji_ranges}]"
    return re.findall(pattern, text)


def pick_focus_author(
    author_ids: List[str], authors: Dict[str, str], needle: str
) -> str | None:
    needle_lower = needle.lower()
    for aid in author_ids:
        if needle_lower in authors.get(aid, aid).lower():
            return aid
    return None


def is_numeric_id(token: str) -> bool:
    return token.isdigit() and len(token) >= 5


def count_punct(text: str) -> Counter:
    c = Counter()
    punctuations = ["!", "?", "...", ".", ",", ";", ":", '"', "'"]
    for mark in punctuations:
        if mark == "...":
            c["..."] += text.count("...")
        elif mark == "'":
            c["'"] += text.count("'")
        else:
            c[mark] += text.count(mark)
    return c


def char_trigrams(text: str) -> Counter:
    cleaned = re.sub(r"\s+", " ", text.lower())
    c = Counter()
    for i in range(len(cleaned) - 2):
        trigram = cleaned[i : i + 3]
        if trigram.strip():
            c[trigram] += 1
    return c


def find_laughter(text: str) -> Counter:
    c = Counter()
    patterns = [r"\bha+ha+\b", r"\bl+o+l+\b", r"\blmao\b", r"\b(rofl|lmfao)\b"]
    for pat in patterns:
        for _ in re.finditer(pat, text, flags=re.IGNORECASE):
            c[pat] += 1
    return c


def sentence_word_counts(text: str) -> List[int]:
    parts = re.split(r"[.!?]+", text)
    counts: List[int] = []
    for part in parts:
        words = basic_words(part)
        if words:
            counts.append(len(words))
    return counts


def estimate_typos(words: List[str]) -> int:
    typos = 0
    for w in words:
        if len(w) < 4:
            continue
        cleaned = re.sub(r"[^A-Za-z]+", "", w).lower()
        if not cleaned:
            continue
        if cleaned in STOPWORDS or cleaned in COMMON_WORDS:
            continue
        # Heuristic: alphabetic-looking words not in a small common set are treated as typos.
        if cleaned.isalpha():
            typos += 1
    return typos


STYLE_MARKERS = [
    ("maybe", r"\bmaybe\b"),
    ("idk", r"\bidk\b"),
    ("idc", r"\bidc\b"),
    ("kinda", r"\bkinda\b"),
    ("sorta", r"\bsorta\b"),
    ("probably", r"\bprobably\b"),
    ("perhaps", r"\bperhaps\b"),
    ("guess", r"\bguess\b"),
    ("ngl", r"\bngl\b"),
    ("honestly", r"\bhonestly\b"),
    ("literally", r"\bliterally\b"),
    ("actually", r"\bactually\b"),
    ("really", r"\breally\b"),
    ("super", r"\bsuper\b"),
    ("lowkey", r"\blow ?key\b"),
    ("highkey", r"\bhigh ?key\b"),
    ("imo", r"\bimo\b"),
    ("fr", r"\bfr\b"),
    ("bro", r"\bbro\b"),
    ("dude", r"\bdude\b"),
    ("bruh", r"\bbruh\b"),
    ("nah", r"\bnah\b"),
    ("yo", r"\byo\b"),
    ("yall", r"\byall\b"),
    ("wtf", r"\bwtf\b"),
    ("omg", r"\bomg\b"),
    ("dang", r"\bdang\b"),
    ("pls", r"\b(pls|please)\b"),
    ("jk", r"\bjk\b"),
    ("gg", r"\bgg\b"),
    ("wdym", r"\bwdym\b"),
]


def collect_style_markers(text: str) -> Counter:
    c = Counter()
    for name, pat in STYLE_MARKERS:
        hits = re.findall(pat, text, flags=re.IGNORECASE)
        if hits:
            c[name] += len(hits)
    return c


MENTION_RE = re.compile(r"<@!?(?P<id>\d+)>|@(?P<name>[\w\.\-]+)")


def extract_mentions(text: str) -> List[str]:
    mentions: List[str] = []
    for match in MENTION_RE.finditer(text):
        mentions.append(match.group("id") or match.group("name"))
    return mentions


def has_code_block(text: str) -> bool:
    return "```" in text or re.search(r"`[^`]+`", text) is not None


def is_multiline(text: str) -> bool:
    return "\n" in text.strip()


def has_stretchy_word(text: str) -> bool:
    return re.search(r"(.)\1{2,}", text, flags=re.IGNORECASE) is not None


def uppercase_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.isupper()) / len(letters)


def percentile(data: List[int], pct: float) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * pct
    low = math.floor(k)
    high = math.ceil(k)
    if low == high:
        return float(sorted_data[int(k)])
    return float(
        sorted_data[low] + (sorted_data[high] - sorted_data[low]) * (k - low)
    )


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name.strip())
    return cleaned.strip("_") or "user"


def render_author_text(payload: Dict[str, object]) -> str:
    lines = [
        f"author: {payload['author']} ({payload.get('author_id', 'unknown')})",
        f"messages: {payload['messages']}",
        f"volume: avg_words {payload['avg_words']}, median_words {payload['median_words']}, p90_words {payload['p90_words']}, avg_chars {payload['avg_chars']}, p90_chars {payload['p90_chars']}",
        f"lexical: ttr {payload['lexical_diversity']}, hapax {payload['hapax_ratio']}, caps/msg {payload['caps_rate']}",
        f"sentences: avg_words {payload['avg_sentence_words']}",
        f"words: avg_len {payload['avg_word_length']}, variety {payload['word_variety']}, typos/msg {payload['typo_rate']}",
        "tokens: " + ", ".join(f"{t} ({w})" for t, w in payload["top_tokens"]),
        "char_trigrams: " + (", ".join(f"{t} ({c})" for t, c in payload["top_char_trigrams"]) or "-"),
        "style_markers: " + (", ".join(f"{m} ({c})" for m, c in payload["style_markers"]) or "-"),
        "laughter: " + (", ".join(f"{pat} ({c})" for pat, c in payload["laughter"]) or "-"),
        "emoji: " + (", ".join(f"{e} ({c})" for e, c in payload["emoji"]) or "-"),
        "openers: "
        + (", ".join(f"{w} ({c})" for w, c in payload["openers1"]) or "-")
        + " | "
        + (", ".join(f"{w} ({c})" for w, c in payload["openers2"]) or "-"),
        "closers: "
        + (", ".join(f"{w} ({c})" for w, c in payload["closers1"]) or "-")
        + " | "
        + (", ".join(f"{w} ({c})" for w, c in payload["closers2"]) or "-"),
        "cadence: "
        + (", ".join(f"{p} ({c})" for p, c in payload["punct"]) or "-")
        + " | repeats "
        + (", ".join(f"{p} ({c})" for p, c in payload["repeat_punct"]) or "-")
        + f" | ?/msg {payload['question_rate']} !/msg {payload['exclaim_rate']} .../msg {payload['ellipsis_rate']}",
        "formatting: "
        + f"links/msg {payload['link_rate']} mentions/msg {payload['mention_rate']} quotes/msg {payload['quote_rate']} code/msg {payload['code_rate']} multiline/msg {payload['multiline_rate']} stretch/msg {payload['stretch_rate']} shout/msg {payload['shout_rate']}",
        "hours: " + (", ".join(str(h) for h in payload["hour_peaks"]) or "-"),
    ]
    if payload["mentions"]:
        lines.append(
            "mentions: " + ", ".join(f"{m} ({c})" for m, c in payload["mentions"])
        )
    if payload["representative"]:
        lines.append("representative: " + str(payload["representative"]))
    if payload.get("interesting_messages"):
        lines.append("interesting:")
        for idx, (msg, score) in enumerate(payload["interesting_messages"], start=1):
            lines.append(f"{idx:2d}. ({round(score,3)}) {msg}")
    if payload["quotes"]:
        lines.append("quotes:")
        for q, c in payload["quotes"]:
            lines.append(f'- "{q}" ({c})')
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Local TF-IDF chat style analysis.")
    parser.add_argument("--guild", "-g", default="all")
    parser.add_argument("--all", action="store_true", help="Analyze all guilds under ./data")
    parser.add_argument("--include-bots", action="store_true", help="Include bot users")
    parser.add_argument("--top", type=int, default=8, help="Top items to show")
    parser.add_argument("--min-phrase", type=int, default=5, help="Minimum count for an n-gram")
    parser.add_argument("--quotes-per-user", type=int, default=20, help="Top quotes per user")
    parser.add_argument("--min-quote-words", type=int, default=2, help="Minimum words per quote")
    parser.add_argument(
        "--focus-user",
        type=str,
        default=None,
        help="Substring of author name to spotlight (style card + quotes)",
    )
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="Output format: human-friendly text or JSON for downstream use",
    )
    parser.add_argument(
        "--dump",
        action="store_true",
        help="Write per-user detailed files to ./out (or --dump-dir)",
    )
    parser.add_argument(
        "--dump-dir",
        type=str,
        default=None,
        help="Custom output directory for per-user files (implies --dump)",
    )
    parser.add_argument(
        "--dump-format",
        choices=["text", "json"],
        default="text",
        help="Per-user file format when dumping",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent / "data"
    dump_dir = (
        Path(args.dump_dir)
        if args.dump_dir
        else (Path(__file__).resolve().parent / "out" if args.dump else None)
    )
    guild = None if args.all else args.guild
    csv_files = walk_csvs(base_dir, guild)
    if not csv_files:
        raise SystemExit(f"No CSVs found under {base_dir}")

    authors: Dict[str, str] = {}
    messages_by_author: Dict[str, List[str]] = defaultdict(list)
    token_counts: Dict[str, Counter] = defaultdict(Counter)
    # 3/4-gram phrase tracking removed (was noisy)
    phrase_counts: Counter = Counter()
    phrase_counts_by_author: Dict[str, Counter] = defaultdict(Counter)
    quotes_by_author: Dict[str, Counter] = defaultdict(Counter)
    emoji_by_author: Dict[str, Counter] = defaultdict(Counter)
    raw_message_counts: Dict[str, int] = defaultdict(int)
    word_lengths_by_author: Dict[str, List[int]] = defaultdict(list)
    char_lengths_by_author: Dict[str, List[int]] = defaultdict(list)
    mentions_by_author: Dict[str, Counter] = defaultdict(Counter)
    link_counts_by_author: Dict[str, int] = defaultdict(int)
    quote_block_by_author: Dict[str, int] = defaultdict(int)
    code_blocks_by_author: Dict[str, int] = defaultdict(int)
    multiline_by_author: Dict[str, int] = defaultdict(int)
    stretchy_by_author: Dict[str, int] = defaultdict(int)
    shouty_by_author: Dict[str, int] = defaultdict(int)
    repeated_punct_by_author: Dict[str, Counter] = defaultdict(Counter)
    hours_by_author: Dict[str, Counter] = defaultdict(Counter)
    markers_by_author: Dict[str, Counter] = defaultdict(Counter)
    opener1_by_author: Dict[str, Counter] = defaultdict(Counter)
    opener2_by_author: Dict[str, Counter] = defaultdict(Counter)
    closer1_by_author: Dict[str, Counter] = defaultdict(Counter)
    closer2_by_author: Dict[str, Counter] = defaultdict(Counter)
    punct_by_author: Dict[str, Counter] = defaultdict(Counter)
    uppercase_words_by_author: Dict[str, Counter] = defaultdict(Counter)
    char_count_by_author: Dict[str, int] = defaultdict(int)
    char_trigrams_by_author: Dict[str, Counter] = defaultdict(Counter)
    laughter_by_author: Dict[str, Counter] = defaultdict(Counter)
    sentence_lengths_by_author: Dict[str, List[int]] = defaultdict(list)
    word_char_lengths_by_author: Dict[str, List[int]] = defaultdict(list)
    typo_counts_by_author: Dict[str, int] = defaultdict(int)

    for csv_path in csv_files:
        for msg in read_csv_messages(csv_path, include_bots=args.include_bots):
            if USER_ID_ALIASES and msg.author_id not in USER_ID_ALIASES:
                continue
            author_key = msg.author_id
            authors[author_key] = msg.author_name
            norm = normalize_content(msg.content)
            toks = tokenize(norm)
            all_words = basic_words(norm)
            if not toks and not all_words:
                continue
            raw_message_counts[author_key] += 1
            messages_by_author[author_key].append(msg.content.strip())
            token_counts[author_key].update(toks)
            word_lengths_by_author[author_key].append(len(toks))
            char_lengths_by_author[author_key].append(len(msg.content))
            char_count_by_author[author_key] += len(msg.content)
            word_char_lengths_by_author[author_key].extend(len(w) for w in all_words)
            sentence_lengths_by_author[author_key].extend(sentence_word_counts(msg.content))
            typo_counts_by_author[author_key] += estimate_typos(all_words)
            uppercase_words_by_author[author_key].update(
                [t for t in toks if t.isupper() and len(t) > 1]
            )
            char_trigrams_by_author[author_key].update(char_trigrams(norm))
            laughter_by_author[author_key].update(find_laughter(norm))
            mentions_by_author[author_key].update(extract_mentions(msg.content))
            if re.search(r"https?://", msg.content):
                link_counts_by_author[author_key] += 1
            if re.search(r'(^|\n)>\s*\S', msg.content):
                quote_block_by_author[author_key] += 1
            if has_code_block(msg.content):
                code_blocks_by_author[author_key] += 1
            if is_multiline(msg.content):
                multiline_by_author[author_key] += 1
            if has_stretchy_word(msg.content):
                stretchy_by_author[author_key] += 1
            if uppercase_ratio(msg.content) >= 0.6:
                shouty_by_author[author_key] += 1
            for pat in [r"\?{2,}", r"!{2,}", r"(?:\?+!+|!+\?+)"]:
                for hit in re.findall(pat, msg.content):
                    repeated_punct_by_author[author_key][hit] += 1
            if msg.timestamp:
                hours_by_author[author_key][msg.timestamp.hour] += 1
            markers_by_author[author_key].update(collect_style_markers(norm))
            if toks:
                opener1_by_author[author_key].update([toks[0]])
                if len(toks) >= 2:
                    opener2_by_author[author_key].update([" ".join(toks[:2])])
                    closer2_by_author[author_key].update([" ".join(toks[-2:])])
                closer1_by_author[author_key].update([toks[-1]])
                # Skipping phrase n-grams
                norm_quote = " ".join(toks)
                if len(toks) >= args.min_quote_words:
                    quotes_by_author[author_key].update([norm_quote])
            emoji_by_author[author_key].update(extract_unicode_emoji(msg.content))
            punct_by_author[author_key].update(count_punct(msg.content))

    tfidf = compute_tfidf(token_counts)
    total_messages = sum(len(v) for v in messages_by_author.values())
    author_order = sorted(
        [aid for aid in tfidf.keys() if raw_message_counts.get(aid, 0) >= 100],
        key=lambda aid: len(messages_by_author.get(aid, [])),
        reverse=True,
    )

    def author_payload(aid: str) -> Dict[str, object]:
        vec = tfidf[aid]
        msgs = messages_by_author.get(aid, [])
        msg_count = raw_message_counts[aid]
        total_tokens = sum(token_counts[aid].values())
        unique_tokens = len(token_counts[aid])
        hapax = sum(1 for v in token_counts[aid].values() if v == 1)
        avg_word_length = (
            sum(word_char_lengths_by_author[aid]) / len(word_char_lengths_by_author[aid])
            if word_char_lengths_by_author[aid]
            else 0
        )
        avg_sentence_words = (
            sum(sentence_lengths_by_author[aid]) / len(sentence_lengths_by_author[aid])
            if sentence_lengths_by_author[aid]
            else 0
        )
        avg_words = (
            sum(len(tokenize(normalize_content(m))) for m in msgs) / len(msgs)
            if msgs
            else 0
        )
        avg_chars = (char_count_by_author[aid] / msg_count) if msg_count else 0
        median_words = percentile(word_lengths_by_author[aid], 0.5)
        p90_words = percentile(word_lengths_by_author[aid], 0.9)
        p90_chars = percentile(char_lengths_by_author[aid], 0.9)
        question_rate = (
            punct_by_author[aid].get("?", 0) / msg_count if msg_count else 0
        )
        exclaim_rate = (
            punct_by_author[aid].get("!", 0) / msg_count if msg_count else 0
        )
        ellipsis_rate = (
            punct_by_author[aid].get("...", 0) / msg_count if msg_count else 0
        )
        caps_rate = (
            sum(uppercase_words_by_author[aid].values()) / msg_count
            if msg_count
            else 0
        )
        link_rate = link_counts_by_author[aid] / msg_count if msg_count else 0
        mention_rate = (
            sum(mentions_by_author[aid].values()) / msg_count if msg_count else 0
        )
        quote_rate = quote_block_by_author[aid] / msg_count if msg_count else 0
        code_rate = code_blocks_by_author[aid] / msg_count if msg_count else 0
        multiline_rate = multiline_by_author[aid] / msg_count if msg_count else 0
        stretch_rate = stretchy_by_author[aid] / msg_count if msg_count else 0
        shout_rate = shouty_by_author[aid] / msg_count if msg_count else 0
        typo_rate = typo_counts_by_author[aid] / msg_count if msg_count else 0
        interesting = score_messages(msgs, vec, limit=20)
        return {
            "author": authors.get(aid, aid),
            "author_id": aid,
            "messages": msg_count,
            "avg_words": round(avg_words, 2),
            "avg_chars": round(avg_chars, 2),
            "median_words": round(median_words, 2),
            "p90_words": round(p90_words, 2),
            "p90_chars": round(p90_chars, 2),
            "lexical_diversity": round(
                unique_tokens / total_tokens, 3
            )
            if total_tokens
            else 0,
            "word_variety": unique_tokens,
            "hapax_ratio": round(hapax / total_tokens, 3) if total_tokens else 0,
            "avg_word_length": round(avg_word_length, 3),
            "avg_sentence_words": round(avg_sentence_words, 3),
            "top_tokens": top_items(vec, 8),
            "top_char_trigrams": top_items(char_trigrams_by_author[aid], 6),
            "laughter": top_items(laughter_by_author[aid], 4),
            "emoji": top_items(emoji_by_author[aid], 6),
            "openers1": top_items(opener1_by_author[aid], 5),
            "openers2": top_items(opener2_by_author[aid], 5),
            "closers1": top_items(closer1_by_author[aid], 5),
            "closers2": top_items(closer2_by_author[aid], 5),
            "punct": top_items(punct_by_author[aid], 6),
            "repeat_punct": top_items(repeated_punct_by_author[aid], 4),
            "question_rate": round(question_rate, 3),
            "exclaim_rate": round(exclaim_rate, 3),
            "ellipsis_rate": round(ellipsis_rate, 3),
            "caps_rate": round(caps_rate, 3),
            "link_rate": round(link_rate, 3),
            "mention_rate": round(mention_rate, 3),
            "quote_rate": round(quote_rate, 3),
            "code_rate": round(code_rate, 3),
            "multiline_rate": round(multiline_rate, 3),
            "stretch_rate": round(stretch_rate, 3),
            "shout_rate": round(shout_rate, 3),
            "typo_rate": round(typo_rate, 3),
            "mentions": top_items(mentions_by_author[aid], 5),
            "style_markers": top_items(markers_by_author[aid], 6),
            "hour_peaks": [h for h, _ in top_items(hours_by_author[aid], 3)],
            "representative": pick_representative_message(msgs, vec),
            "interesting_messages": interesting,
            "quotes": top_items(quotes_by_author[aid], args.quotes_per_user),
        }

    payload_cache: Dict[str, Dict[str, object]] = {
        aid: author_payload(aid) for aid in author_order
    }

    if dump_dir:
        dump_dir.mkdir(parents=True, exist_ok=True)
        for payload in payload_cache.values():
            fname = sanitize_filename(str(payload["author"] or payload["author_id"]))
            ext = "json" if args.dump_format == "json" else "txt"
            out_path = dump_dir / f"{fname}.{ext}"
            if args.dump_format == "json":
                out_path.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            else:
                out_path.write_text(render_author_text(payload), encoding="utf-8")
        print(f"Wrote {len(payload_cache)} files to {dump_dir}")

    if args.format == "json":
        output = {
            "summary": {
                "messages": total_messages,
                "authors": len(authors),
                "files": len(csv_files),
            },
            "authors": [payload_cache[aid] for aid in author_order[: args.top]],
            "neighbors": [
                {
                    "author": authors.get(aid, aid),
                    "nearest": [
                        (authors.get(bid, bid), round(sim, 3))
                        for sim, bid in sorted(
                            (
                                (cosine_similarity(tfidf[aid], tfidf[bid]), bid)
                                for bid in author_order
                                if bid != aid
                            ),
                            reverse=True,
                        )[:3]
                    ],
                }
                for aid in author_order[: args.top]
            ],
        }
        print(json.dumps(output, indent=2))
        return

    # Human-readable output
    print(
        f"Analyzed {total_messages:,} messages from {len(authors)} authors across {len(csv_files)} file(s)."
    )
    print("\nStyle cards (LLM-ready voice guide):")
    for idx, aid in enumerate(author_order[: args.top], start=1):
        payload = payload_cache[aid]
        print(f"{idx}. {payload['author']}")
        print(
            f"   volume      : {payload['messages']} msgs | avg {payload['avg_words']:.1f}w | median {payload['median_words']:.1f}w | p90 {payload['p90_words']:.1f}w | p90 chars {payload['p90_chars']:.0f}"
        )
        print(
            f"   lexical     : ttr {payload['lexical_diversity']:.2f} | hapax {payload['hapax_ratio']:.2f} | caps/msg {payload['caps_rate']:.2f}"
        )
        print(
            f"   sentences   : avg {payload['avg_sentence_words']:.2f} words"
        )
        print(
            f"   words       : avg_len {payload['avg_word_length']:.2f} | variety {payload['word_variety']} | typos/msg {payload['typo_rate']:.2f}"
        )
        print(
            "   tokens      : "
            + ", ".join(f"{t} ({w:.2f})" for t, w in payload["top_tokens"])
        )
        print(
            "   char3       : "
            + (", ".join(f"{t} ({c})" for t, c in payload["top_char_trigrams"]) or "-")
        )
        markers = ", ".join(f"{m} ({c})" for m, c in payload["style_markers"]) or "-"
        laugh = ", ".join(f"{pat} ({c})" for pat, c in payload["laughter"]) or "-"
        print(f"   markers     : {markers}")
        print(f"   laughter    : {laugh}")
        print(
            "   emoji       : "
            + (", ".join(f"{e} ({c})" for e, c in payload["emoji"]) or "-")
        )
        print(
            "   openers     : "
            + (", ".join(f"{w} ({c})" for w, c in payload["openers1"]) or "-")
            + " | "
            + (", ".join(f"{w} ({c})" for w, c in payload["openers2"]) or "-")
        )
        print(
            "   closers     : "
            + (", ".join(f"{w} ({c})" for w, c in payload["closers1"]) or "-")
            + " | "
            + (", ".join(f"{w} ({c})" for w, c in payload["closers2"]) or "-")
        )
        punct = ", ".join(f"{p} ({c})" for p, c in payload["punct"]) or "-"
        repeat_punct = (
            ", ".join(f"{p} ({c})" for p, c in payload["repeat_punct"]) or "-"
        )
        hours = ", ".join(str(h) for h in payload["hour_peaks"]) or "-"
        print(
            f"   cadence     : {punct} | repeats {repeat_punct} | ?/msg {payload['question_rate']:.2f} !/msg {payload['exclaim_rate']:.2f} .../msg {payload['ellipsis_rate']:.2f}"
        )
        print(
            "   formatting  : "
            + f"links/msg {payload['link_rate']:.2f} | mentions/msg {payload['mention_rate']:.2f} | quotes/msg {payload['quote_rate']:.2f} | code/msg {payload['code_rate']:.2f} | multiline/msg {payload['multiline_rate']:.2f} | stretch/msg {payload['stretch_rate']:.2f} | shout/msg {payload['shout_rate']:.2f} | hours {hours}"
        )
        if payload["mentions"]:
            print(
                "   mentions    : "
                + ", ".join(f"{m} ({c})" for m, c in payload["mentions"])
            )
        if payload["representative"]:
            print(f"   rep         : {payload['representative'][:160]}")
        if payload.get("interesting_messages"):
            snippets = "; ".join(
                f'"{msg[:120]}" ({score:.2f})'
                for msg, score in payload["interesting_messages"]
            )
            print(f"   interesting : {snippets}")
        if payload["quotes"]:
            print("   quotes      : " + "; ".join(f'"{q}" ({c})' for q, c in payload["quotes"][: args.quotes_per_user]))
        print()
    print("Nearest stylistic neighbors (TF-IDF cosine):")
    for aid in author_order[: args.top]:
        scores = []
        for bid in author_order:
            if aid == bid:
                continue
            sim = cosine_similarity(tfidf[aid], tfidf[bid])
            scores.append((sim, bid))
        scores.sort(reverse=True)
        neighbors = ", ".join(
            f"{authors.get(bid, bid)} ({sim:.2f})" for sim, bid in scores[:3]
        )
        print(f"- {authors.get(aid, aid)} -> {neighbors}")

    if args.focus_user:
        target = pick_focus_author(author_order, authors, args.focus_user)
        if target:
            print(f"\nFocus user: {authors.get(target, target)}")
            quotes = top_items(quotes_by_author[target], args.quotes_per_user)
            for q, c in quotes:
                print(f'  "{q}" ({c})')
        else:
            print(f"\nFocus user '{args.focus_user}' not found.")


if __name__ == "__main__":
    main()
