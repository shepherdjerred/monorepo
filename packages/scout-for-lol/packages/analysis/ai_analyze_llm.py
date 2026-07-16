#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#     "openai>=1.30.0",
#     "pydantic>=2.0",
#     "tiktoken>=0.7.0",
# ]
# ///
"""
LLM-driven style profiler for Discord CSV exports.

Reads one author's full message history (from ./data) and asks an LLM to
surface representative quotes, style markers, and personality signals. The
script is budget-aware: it estimates token usage and refuses to run if the
projection exceeds the configured dollar budget.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TypedDict

import tiktoken
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel, TypeAdapter

# Central model catalog (single source of truth) — see packages/llm-models.
_CATALOG_PATH = (
    Path(__file__).resolve().parents[3] / "llm-models" / "src" / "catalog.json"
)


class _CatalogPricing(BaseModel):
    input: float | None = None
    output: float | None = None


class _CatalogEntry(BaseModel):
    pricing: _CatalogPricing
    contextWindow: int | None = None


def _load_catalog() -> dict[str, _CatalogEntry]:
    raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return TypeAdapter(dict[str, _CatalogEntry]).validate_python(raw)


_CATALOG = _load_catalog()


def _per_token_prices(model: str) -> tuple[float, float]:
    """(input, output) USD per token from the catalog; (0, 0) if unknown."""
    entry = _CATALOG.get(model)
    if entry and entry.pricing.input is not None and entry.pricing.output is not None:
        return entry.pricing.input / 1_000_000, entry.pricing.output / 1_000_000
    return 0.0, 0.0


class ModeConfig(TypedDict):
    model: str
    input_price: float
    output_price: float
    temperature: float


def _mode_config(model: str, temperature: float) -> ModeConfig:
    in_price, out_price = _per_token_prices(model)
    return {
        "model": model,
        "input_price": in_price,
        "output_price": out_price,
        "temperature": temperature,
    }


DEFAULT_MODEL = "gpt-5.4-nano"

# Context-window limits, derived from the catalog (id -> contextWindow).
MODEL_CONTEXT_LIMITS = {
    model_id: entry.contextWindow
    for model_id, entry in _CATALOG.items()
    if entry.contextWindow is not None
}

MODE_CONFIGS = {
    "test": _mode_config("gpt-5.4-nano", 0.3),
    "prod": _mode_config("gpt-5.5", 1.0),
}

# Fallback per-token prices for DEFAULT_MODEL (overridable via CLI flags).
INPUT_PRICE_PER_TOKEN, OUTPUT_PRICE_PER_TOKEN = _per_token_prices(DEFAULT_MODEL)

# Optional manual overrides for how author IDs should be displayed in output.
# Example: {"123456789012345678": "Alice"}
USER_ID_ALIASES: dict[str, str] = {
    # "186665676134547461": "Aaron",
    # "202595851678384137": "Brian",
    # "410595870380392458": "Irfan",
    # "200067001035653131": "Ryan",
    # "263577791105073152": "Danny",
    # "208425244128444418": "Virmel",
    # "251485022429642752": "Long",
    # "160509172704739328": "Jerred",
    "171455587517857796": "Colin",
    # "331238905619677185": "Caitlyn",
    # "121887985896521732": "Richard",
}


@dataclass
class Message:
    author_id: str
    author_name: str
    content: str
    is_bot: bool
    timestamp: datetime | None


def resolve_author_name(name: str) -> str:
    cleaned = name.strip()
    return cleaned or "Unknown"


def normalize_content(text: str) -> str:
    text = re.sub(r"https?://\S+", " ", text)
    text = text.replace("\u200b", " ")
    return text.strip()


def tokenize(text: str) -> list[str]:
    lowered = text.lower()
    return re.findall(r"[a-z0-9']+", lowered)


def read_csv_messages(
    path: Path,
    include_bots: bool,
    id_aliases: dict[str, str],
) -> Iterable[Message]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            return
        columns = {name: idx for idx, name in enumerate(header)}

        def cell(row: list[str], name: str, default: str) -> str:
            idx = columns.get(name)
            return row[idx] if idx is not None else default

        for row in reader:
            content = cell(row, "content", "")
            if not content:
                continue
            ts_raw = cell(row, "timestamp", "") or cell(row, "date", "")
            timestamp = None
            if ts_raw:
                try:
                    timestamp = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                except ValueError:
                    timestamp = None
            raw_author_name = (
                (cell(row, "author.global_name", "") or None)
                or (cell(row, "author.username", "") or None)
                or "Unknown"
            )
            author_id = cell(row, "author.id", "unknown")
            mapped_name = id_aliases.get(author_id)
            author_name = resolve_author_name(mapped_name or raw_author_name)
            bot_flag = cell(row, "author.bot", "false")
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


def walk_csvs(base_dir: Path, guild: str | None) -> list[Path]:
    root = base_dir if guild in (None, "all") else base_dir / guild
    return [p for p in root.rglob("*.csv") if p.is_file()]


def count_tokens(text: str, encoding: tiktoken.Encoding) -> int:
    return len(encoding.encode(text))


def truncate_corpus(
    lines: Sequence[str], encoding: tiktoken.Encoding, max_tokens: int
) -> tuple[list[str], int]:
    """Trim from the front (oldest) if the corpus exceeds the token budget."""
    tokens_used = 0
    kept: list[str] = []
    for line in reversed(lines):  # start from most recent
        line_tokens = count_tokens(line, encoding)
        if tokens_used + line_tokens > max_tokens:
            break
        kept.append(line)
        tokens_used += line_tokens
    kept.reverse()
    return kept, tokens_used


def estimate_cost(
    input_tokens: int, output_tokens: int, args: argparse.Namespace
) -> float:
    in_price = args.input_price or INPUT_PRICE_PER_TOKEN
    out_price = args.output_price or OUTPUT_PRICE_PER_TOKEN
    return (input_tokens * in_price) + (output_tokens * out_price)


def format_corpus(messages: list[Message]) -> list[str]:
    lines = []
    for msg in messages:
        ts = msg.timestamp.isoformat() if msg.timestamp else "unknown"
        content = msg.content.replace("\n", " ").strip()
        if not content:
            continue
        lines.append(f"[{ts}] {content}")
    return lines


class Stats(TypedDict):
    messages: int
    top_tokens: list[tuple[str, int]]
    avg_words: float
    median_words: float
    date_range: str


def build_user_prompt(
    author: str, stats: Stats, corpus_lines: list[str]
) -> str:
    top_tokens_text = (
        ", ".join(f"{tok} ({cnt})" for tok, cnt in stats["top_tokens"]) or "-"
    )
    return (
        f"User: {author}\n"
        f"Messages: {stats['messages']} spanning {stats['date_range']}\n"
        f"Words: avg {stats['avg_words']:.1f}, median {stats['median_words']:.1f}\n"
        f"Top tokens: {top_tokens_text}\n"
        "Chat log (one line per message):\n" + "\n".join(corpus_lines)
    )


SYSTEM_PROMPT = (
    "You are a thorough voice/style profiler for a single user's chat log.\n"
    "You receive only this user's messages (chronological lines). "
    "Read closely for tone, stance, and repeated moves.\n"
    "Return ONE JSON object with these keys:\n"
    "- author: display name\n"
    "- coverage: {messages, date_range, truncated?: bool, notes}\n"
    "- voice: bullets on register, punctuation/emoji cadence, formatting habits "
    "(code, block quotes), pacing, sentence/word shapes\n"
    "- style_markers: notable words/phrases, slang, hedges, intensifiers, rhetorical tics (keep short)\n"
    "- topics: bullets of recurring subjects, jargon, interests, or motifs (note any fixation/avoidance)\n"
    "- relationships: mentions or implied ties (e.g., who they praise/tease/ask for help), if any\n"
    "- behaviors: activity/consistency observations (questions vs statements, commands, corrections, "
    "apologies, thanks, bragging, venting)\n"
    "- personality: 4-8 bullets inferring tendencies, attitudes, or values grounded in the text "
    "(no armchair psych)\n"
    "- humor_or_tone: humor modes (sarcasm, deadpan, slapstick, puns) or emotional palette "
    "(e.g., chill, hyped, prickly)\n"
    "- quotes: 12-20 cherry-picked lines that are funny/memorable/defining (brevity preferred)\n"
    "- summary: 3-4 tight sentences stitching the above into a usable style card\n"
    "- likes_dislikes: bullets of stated or implied likes/dislikes (food, media, habits, people, phrases); "
    "cite evidence briefly\n"
    "- league: if they talk about League of Legends, list liked vs disliked lanes/champions/items/roles "
    '(separate), plus team moods; "none" if unclear\n'
    '- other_games: list other games they mention or play; "none" if not present\n'
    "- how_to_mimic: actionable bullets on how to sound like them: openers/closers, "
    "pacing (short/long, run-ons vs staccato), question vs statement balance, "
    "punctuation cadence (??, !!, ellipses), caps/uppercase or stretchy letters, "
    "emoji/laughter habits, hyperlink/mention/quote/code/multiline frequency, "
    "slang/signature phrases to sprinkle, typical word/sentence lengths\n"
    "- sample_messages: 100 varied verbatim messages (covering different moods/topics/tones; "
    "include some mundane for balance). If fewer than 100 exist, include all available.\n"
    "\n"
    "Rules:\n"
    "- Never invent content; only surface what the log shows.\n"
    "- Prefer concrete, observable descriptors over generic adjectives.\n"
    "- Keep JSON valid, concise, and ready to paste into code."
)


def compute_stats(messages: list[Message]) -> Stats:
    tokens: Counter[str] = Counter()
    word_counts = []
    timestamps = [msg.timestamp for msg in messages if msg.timestamp]
    for msg in messages:
        words = tokenize(normalize_content(msg.content))
        word_counts.append(len(words))
        tokens.update(words)
    top_tokens = tokens.most_common(12)
    avg_words = sum(word_counts) / len(word_counts) if word_counts else 0
    median_words = 0.0
    if word_counts:
        sorted_counts = sorted(word_counts)
        mid = len(sorted_counts) // 2
        if len(sorted_counts) % 2:
            median_words = float(sorted_counts[mid])
        else:
            median_words = (sorted_counts[mid - 1] + sorted_counts[mid]) / 2.0
    date_range = "-"
    if timestamps:
        first = min(timestamps)
        last = max(timestamps)
        date_range = f"{first.date().isoformat()} to {last.date().isoformat()}"
    return {
        "messages": len(messages),
        "top_tokens": top_tokens,
        "avg_words": avg_words,
        "median_words": median_words,
        "date_range": date_range,
    }


def pick_authors(
    messages_by_author: dict[str, list[Message]],
    author_ids_by_author: dict[str, set[str]],
    args: argparse.Namespace,
    id_aliases: dict[str, str],
) -> list[str]:
    authors = sorted(
        [
            aid
            for aid, msgs in messages_by_author.items()
            if len(msgs) >= args.min_messages
        ],
        key=lambda aid: len(messages_by_author[aid]),
        reverse=True,
    )
    # Filter to only users in USER_ID_ALIASES (unless --users or --user overrides)
    if not args.users and not args.user:
        authors = [
            aid
            for aid in authors
            if any(uid in id_aliases for uid in author_ids_by_author.get(aid, set()))
        ]
    if args.users:
        wanted = {name.lower() for name in args.users}
        authors = [
            aid
            for aid in authors
            if aid.lower() in wanted
            or any(
                uid.lower() in wanted for uid in author_ids_by_author.get(aid, set())
            )
        ]
    if args.user:
        needle = args.user.lower()
        authors = [aid for aid in authors if needle in aid.lower()]
    if args.top:
        authors = authors[: args.top]
    return authors


def main() -> None:
    parser = argparse.ArgumentParser(
        description="LLM-based style analyzer with test/prod modes."
    )
    parser.add_argument(
        "--guild",
        "-g",
        default="all",
        help='Guild directory under ./data (default: "all")',
    )
    parser.add_argument(
        "--all", action="store_true", help="Analyze all guilds under ./data"
    )
    parser.add_argument(
        "--user", type=str, default=None, help="Substring filter for author names"
    )
    parser.add_argument(
        "--users",
        nargs="+",
        default=None,
        help="Explicit author names to include (case-insensitive, space-separated list)",
    )
    parser.add_argument(
        "--top", type=int, default=10, help="Max authors to analyze (after filtering)"
    )
    parser.add_argument(
        "--min-messages", type=int, default=50, help="Skip authors with fewer messages"
    )
    parser.add_argument("--include-bots", action="store_true", help="Include bot users")
    parser.add_argument(
        "--mode",
        choices=["test", "prod"],
        default="test",
        help="Mode: 'test' uses gpt-5.4-nano (cheap), 'prod' uses gpt-5.4 (better)",
    )
    parser.add_argument(
        "--model", default=None, help="OpenAI model name (overrides --mode default)"
    )
    parser.add_argument(
        "--max-input-tokens",
        type=int,
        default=115_000,
        help="Cap tokens for corpus (system prompt + metadata overhead reserved)",
    )
    parser.add_argument(
        "--max-output-tokens", type=int, default=9_000, help="Cap response tokens"
    )
    parser.add_argument(
        "--budget",
        type=float,
        default=5.0,
        help="Abort if projected spend exceeds this (USD)",
    )
    parser.add_argument(
        "--input-price",
        type=float,
        default=INPUT_PRICE_PER_TOKEN,
        help="Override input price per token (USD)",
    )
    parser.add_argument(
        "--output-price",
        type=float,
        default=OUTPUT_PRICE_PER_TOKEN,
        help="Override output price per token (USD)",
    )
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument(
        "--save-dir",
        type=str,
        default="llm-out",
        help="Write per-user JSON outputs to this directory",
    )
    parser.add_argument(
        "--id-alias-file",
        type=str,
        default=None,
        help="Path to JSON mapping of author.id -> display name (overrides CSV names/aliases)",
    )
    parser.add_argument(
        "--id-alias",
        type=str,
        default=None,
        help="Inline JSON string mapping author.id -> display name (overrides CSV names/aliases)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Estimate cost and payload sizes without calling the API",
    )
    args = parser.parse_args()

    # Apply mode configuration defaults (can be overridden by explicit flags)
    mode_config = MODE_CONFIGS[args.mode]
    if args.model is None:
        args.model = mode_config["model"]
    if args.input_price == INPUT_PRICE_PER_TOKEN:
        args.input_price = mode_config["input_price"]
    if args.output_price == OUTPUT_PRICE_PER_TOKEN:
        args.output_price = mode_config["output_price"]
    if args.temperature == 0.3:  # Only override if still at default
        args.temperature = mode_config["temperature"]

    model: str = str(args.model)

    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit("Set OPENAI_API_KEY before running.")

    id_aliases: dict[str, str] = dict(USER_ID_ALIASES)
    if args.id_alias_file:
        alias_path = Path(args.id_alias_file).expanduser().resolve()
        if not alias_path.exists():
            raise SystemExit(f"ID alias file not found: {alias_path}")
        try:
            id_aliases.update(
                {
                    str(k): str(v)
                    for k, v in json.loads(
                        alias_path.read_text(encoding="utf-8")
                    ).items()
                }
            )
        except Exception as exc:  # pragma: no cover
            raise SystemExit(f"Failed to parse ID alias file: {exc}") from exc
    if args.id_alias:
        try:
            inline_aliases = json.loads(args.id_alias)
            if not isinstance(inline_aliases, dict):
                raise ValueError("Inline alias JSON must be an object")
            id_aliases.update({str(k): str(v) for k, v in inline_aliases.items()})
        except Exception as exc:  # pragma: no cover
            raise SystemExit(f"Failed to parse inline id alias JSON: {exc}") from exc

    base_dir = Path(__file__).resolve().parent / "data"
    guild = None if args.all or args.guild in (None, "all") else args.guild
    csv_files = walk_csvs(base_dir, guild)
    if not csv_files:
        raise SystemExit(f"No CSV files found under {base_dir}")

    messages_by_author: dict[str, list[Message]] = defaultdict(list)
    author_ids_by_author: dict[str, set[str]] = defaultdict(set)
    for csv_path in csv_files:
        for msg in read_csv_messages(
            csv_path, include_bots=args.include_bots, id_aliases=id_aliases
        ):
            key = msg.author_name
            messages_by_author[key].append(msg)
            if msg.author_id:
                author_ids_by_author[key].add(msg.author_id)

    for msgs in messages_by_author.values():
        msgs.sort(key=lambda m: m.timestamp or datetime.min)

    # Try to get encoding for model, fall back to cl100k_base (used by GPT-4/5)
    try:
        encoding = (
            tiktoken.encoding_for_model(model)
            if model
            else tiktoken.get_encoding("cl100k_base")
        )
    except KeyError:
        print(
            f"Warning: No tokenizer found for {model}, using cl100k_base encoding",
            file=sys.stderr,
        )
        encoding = tiktoken.get_encoding("cl100k_base")
    authors = pick_authors(messages_by_author, author_ids_by_author, args, id_aliases)
    if not authors:
        raise SystemExit("No authors matched filters.")

    if args.users and len(args.users) > args.top:
        print(
            f"Warning: --users specified {len(args.users)} users but --top is {args.top}. "
            f"Only the top {args.top} will be analyzed.",
            file=sys.stderr,
        )

    save_dir = Path(args.save_dir).resolve() if args.save_dir else None
    if save_dir:
        save_dir.mkdir(parents=True, exist_ok=True)

    model_limit = MODEL_CONTEXT_LIMITS.get(model, 128_000)

    planned_cost = 0.0
    requests: list[tuple[str, Stats, str, int]] = []
    for author in authors:
        stats = compute_stats(messages_by_author[author])
        corpus_lines = format_corpus(messages_by_author[author])
        limited_lines, _token_count = truncate_corpus(
            corpus_lines, encoding, args.max_input_tokens
        )
        prompt = build_user_prompt(author, stats, limited_lines)
        system_tokens = count_tokens(SYSTEM_PROMPT, encoding)
        user_tokens = count_tokens(prompt, encoding)
        input_tokens = system_tokens + user_tokens

        if input_tokens > model_limit:
            print(
                f"Warning: {author} requires {input_tokens} tokens but model limit is {model_limit}. "
                f"Skipping this author. Lower --max-input-tokens to avoid this.",
                file=sys.stderr,
            )
            continue

        est_cost = estimate_cost(input_tokens, args.max_output_tokens, args)
        planned_cost += est_cost
        requests.append((author, stats, prompt, input_tokens))

    if planned_cost > args.budget:
        raise SystemExit(
            f"Projected cost ${planned_cost:.2f} exceeds budget ${args.budget:.2f}. "
            "Lower --top, --max-input-tokens, or --max-output-tokens."
        )

    print(f"Mode: {args.mode} (model: {model})")
    print(
        f"Preparing {len(requests)} request(s) with projected cost ${planned_cost:.2f} "
        f"(budget ${args.budget:.2f})."
    )
    if args.dry_run:
        for author, _, _, tokens in requests:
            print(
                f"- {author}: ~{tokens} input tokens + {args.max_output_tokens} output tokens"
            )
        return

    client = OpenAI()
    is_o1_model = model.startswith("o1")

    for author, stats, prompt, input_tokens in requests:
        print(f"\n=== {author} ({stats['messages']} msgs) ===")
        print(
            f"Input tokens ~{input_tokens}, output cap {args.max_output_tokens}, "
            f"est cost ${estimate_cost(input_tokens, args.max_output_tokens, args):.4f}"
        )

        # Build API call params (o1 models don't support temperature or response_format)
        messages: list[ChatCompletionMessageParam]
        if is_o1_model:
            # For o1 models, prepend system prompt to user message since they don't support system role
            messages = [
                {"role": "user", "content": f"{SYSTEM_PROMPT}\n\n{prompt}"},
            ]
        else:
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]

        try:
            if is_o1_model:
                completion = client.chat.completions.create(
                    model=model,
                    max_completion_tokens=args.max_output_tokens,
                    messages=messages,
                )
            else:
                completion = client.chat.completions.create(
                    model=model,
                    max_completion_tokens=args.max_output_tokens,
                    messages=messages,
                    temperature=args.temperature,
                    response_format={"type": "json_object"},
                )
        except Exception as exc:  # pragma: no cover
            print(f"OpenAI request failed for {author}: {exc}", file=sys.stderr)
            continue
        content = completion.choices[0].message.content or ""
        print(content)
        if save_dir:
            canonical_id = next(iter(author_ids_by_author.get(author, [])), None)
            alias_name = id_aliases.get(canonical_id) if canonical_id else None
            fname_base = alias_name or author or canonical_id
            safe_name = (
                re.sub(r"[^A-Za-z0-9._-]+", "_", str(fname_base)).strip("_") or "user"
            )
            out_path = save_dir / f"{safe_name.lower()}_style.json"
            out_path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
