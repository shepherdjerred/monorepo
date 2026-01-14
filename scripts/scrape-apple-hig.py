#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "playwright",
#     "beautifulsoup4",
#     "lxml",
# ]
# ///
"""
Apple Human Interface Guidelines Scraper

Recursively scrapes Apple's HIG site and saves HTML files for later processing.

Usage:
    uv run scrape-apple-hig.py [--output DIR] [--delay SECONDS] [--no-resume] [--no-headless]

Environment:
    None required - scraper operates without authentication

Example:
    # Default scrape with resume support
    uv run scrape-apple-hig.py

    # Fresh scrape with slower rate limiting
    uv run scrape-apple-hig.py --no-resume --delay 2.0

    # Debug mode with visible browser
    uv run scrape-apple-hig.py --no-headless
"""

import asyncio
import json
import sys
import time
from argparse import ArgumentParser, RawDescriptionHelpFormatter
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup


@dataclass
class URLTracker:
    """Tracks visited URLs and maintains crawl queue."""

    visited: set[str] = field(default_factory=set)
    queue: deque[str] = field(default_factory=deque)
    base_url: str = "https://developer.apple.com"
    hig_path_prefix: str = "/design/human-interface-guidelines"


@dataclass
class CrawlStats:
    """Track scraping progress and statistics."""

    total_pages: int = 0
    successful: int = 0
    failed: int = 0
    start_time: float = 0.0

    def report(self) -> str:
        """Generate progress report string."""
        elapsed = time.time() - self.start_time
        rate = self.successful / elapsed if elapsed > 0 else 0
        return (
            f"Progress: {self.successful}/{self.total_pages} pages "
            f"({self.failed} failed) "
            f"[{rate:.2f} pages/sec, {elapsed:.0f}s elapsed]"
        )


def normalize_url(url: str) -> str:
    """
    Remove fragments and query params, normalize trailing slash.

    Args:
        url: The URL to normalize

    Returns:
        Normalized URL without fragments or query parameters
    """
    parsed = urlparse(url)
    # Remove trailing slash unless it's the root path
    path = parsed.path.rstrip('/') if parsed.path != '/' else parsed.path
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def is_hig_url(url: str, base_url: str, hig_prefix: str) -> bool:
    """
    Determine if a URL is part of HIG content.

    Rules:
    1. Must be on developer.apple.com domain
    2. Path must start with /design/human-interface-guidelines
    3. Exclude anchors (fragments)
    4. Exclude query parameters

    Args:
        url: URL to check
        base_url: Base URL (https://developer.apple.com)
        hig_prefix: HIG path prefix (/design/human-interface-guidelines)

    Returns:
        True if URL is part of HIG, False otherwise
    """
    # Normalize to absolute URL if relative
    if not url.startswith('http'):
        url = urljoin(base_url, url)

    parsed = urlparse(url)

    # Must be Apple developer domain
    if parsed.netloc != "developer.apple.com":
        return False

    # Must be under HIG path
    if not parsed.path.startswith(hig_prefix):
        return False

    # Exclude anchors and query params (already normalized by normalize_url)
    return True


def url_to_filepath(url: str, base_dir: Path) -> Path:
    """
    Convert URL to filesystem path while preserving structure.

    Strategy:
    - /design/human-interface-guidelines -> hig/index.html
    - /design/human-interface-guidelines/components -> hig/components/index.html
    - /design/human-interface-guidelines/platforms/ios -> hig/platforms/ios/index.html

    Args:
        url: The URL to convert
        base_dir: Base directory for output

    Returns:
        Path object representing where the file should be saved
    """
    parsed = urlparse(url)
    path = parsed.path.removeprefix("/design/human-interface-guidelines")

    if not path or path == "/":
        return base_dir / "index.html"

    # Remove leading/trailing slashes
    path = path.strip("/")

    # Create directory structure
    return base_dir / path / "index.html"


def load_visited_urls(output_dir: Path) -> set[str]:
    """
    Load visited URLs from .visited.json for resume support.

    Args:
        output_dir: Output directory containing .visited.json

    Returns:
        Set of previously visited URLs
    """
    visited_file = output_dir / ".visited.json"
    if visited_file.exists():
        try:
            return set(json.loads(visited_file.read_text()))
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: Could not load visited URLs: {e}", file=sys.stderr)
            return set()
    return set()


def save_visited_urls(output_dir: Path, visited: set[str]) -> None:
    """
    Save visited URLs to .visited.json.

    Args:
        output_dir: Output directory for .visited.json
        visited: Set of visited URLs
    """
    visited_file = output_dir / ".visited.json"
    try:
        visited_file.write_text(json.dumps(sorted(visited), indent=2))
    except OSError as e:
        print(f"Warning: Could not save visited URLs: {e}", file=sys.stderr)


async def fetch_with_retry(
    page,
    url: str,
    max_retries: int = 3,
    timeout: int = 30000,
) -> str | None:
    """
    Fetch page with retry logic and exponential backoff.

    Args:
        page: Playwright page object
        url: URL to fetch
        max_retries: Maximum number of retry attempts
        timeout: Timeout in milliseconds

    Returns:
        HTML content or None if all retries failed
    """
    for attempt in range(max_retries):
        try:
            await page.goto(url, wait_until="networkidle", timeout=timeout)
            # Extra buffer for lazy-loaded content
            await page.wait_for_timeout(1000)
            return await page.content()
        except Exception as e:
            error_msg = str(e).lower()

            # Rate limiting
            if "429" in str(e) or "rate limit" in error_msg:
                delay = 10 * (2 ** attempt)
                print(f"  Rate limited, waiting {delay}s...", file=sys.stderr)
                await asyncio.sleep(delay)
                continue

            # Timeout - retry with backoff
            if "timeout" in error_msg:
                if attempt == max_retries - 1:
                    print(f"  Timeout after {max_retries} attempts", file=sys.stderr)
                    return None
                delay = 2 ** attempt
                print(f"  Timeout, retry {attempt + 1}/{max_retries} in {delay}s...", file=sys.stderr)
                await asyncio.sleep(delay)
                continue

            # Other errors - don't retry
            print(f"  Error: {e}", file=sys.stderr)
            return None

    return None


async def crawl_hig(
    start_url: str,
    output_dir: Path,
    *,
    rate_limit_delay: float = 1.0,
    resume: bool = True,
    headless: bool = True,
) -> CrawlStats:
    """
    Recursively crawl HIG site and save HTML files.

    Args:
        start_url: Starting URL (HIG homepage)
        output_dir: Where to save HTML files
        rate_limit_delay: Delay between requests in seconds
        resume: If True, skip already-downloaded files
        headless: If True, run browser in headless mode

    Returns:
        CrawlStats object with scraping statistics
    """
    from playwright.async_api import async_playwright

    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize tracker
    tracker = URLTracker(
        visited=set(),
        queue=deque([start_url]),
        base_url="https://developer.apple.com",
        hig_path_prefix="/design/human-interface-guidelines"
    )

    # Load resume state
    if resume:
        tracker.visited = load_visited_urls(output_dir)
        print(f"Resuming: {len(tracker.visited)} URLs already visited")

    stats = CrawlStats(start_time=time.time())

    # Start Playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
            ]
        )

        context = await browser.new_context(
            user_agent="Mozilla/5.0 (compatible; HIGScraper/1.0; +https://github.com/shepherdjerred/glern)"
        )

        page = await context.new_page()

        try:
            while tracker.queue:
                url = tracker.queue.popleft()
                normalized = normalize_url(url)

                # Skip if already visited
                if normalized in tracker.visited:
                    continue

                filepath = url_to_filepath(normalized, output_dir)

                # Resume: skip if file exists
                if resume and filepath.exists():
                    tracker.visited.add(normalized)
                    print(f"[SKIP] {url} (already exists)")
                    continue

                # Fetch page
                html = await fetch_with_retry(page, url)

                if html is None:
                    stats.failed += 1
                    # Mark as visited to avoid retrying on resume
                    # (permanently broken pages won't be retried)
                    tracker.visited.add(normalized)
                    print(f"[FAIL] {url}")
                    continue

                # Save HTML
                try:
                    filepath.parent.mkdir(parents=True, exist_ok=True)
                    filepath.write_text(html, encoding='utf-8')
                except OSError as e:
                    stats.failed += 1
                    # Mark as visited to avoid retrying on resume
                    tracker.visited.add(normalized)
                    print(f"[FAIL] {url}: Could not write file: {e}", file=sys.stderr)
                    continue

                # Parse links
                soup = BeautifulSoup(html, 'lxml')
                for link in soup.find_all('a', href=True):
                    href = link['href']
                    absolute_url = urljoin(url, href)

                    if is_hig_url(absolute_url, tracker.base_url, tracker.hig_path_prefix):
                        normalized_link = normalize_url(absolute_url)
                        if normalized_link not in tracker.visited:
                            tracker.queue.append(normalized_link)

                # Mark as visited
                tracker.visited.add(normalized)
                stats.successful += 1
                stats.total_pages = len(tracker.visited) + len(tracker.queue)

                print(f"[OK] {url} -> {filepath.relative_to(output_dir.parent)}")
                print(f"     {stats.report()}")

                # Rate limiting
                if rate_limit_delay > 0:
                    await asyncio.sleep(rate_limit_delay)

        finally:
            await context.close()
            await browser.close()

            # Save visited URLs for resume
            save_visited_urls(output_dir, tracker.visited)

    return stats


def main() -> None:
    """Main entry point with CLI argument parsing."""
    parser = ArgumentParser(
        description="Scrape Apple Human Interface Guidelines",
        formatter_class=RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Default scrape (with resume)
  uv run scrape-apple-hig.py

  # Fresh scrape (no resume)
  uv run scrape-apple-hig.py --no-resume

  # Custom output directory
  uv run scrape-apple-hig.py --output /tmp/hig-data

  # Visible browser (for debugging)
  uv run scrape-apple-hig.py --no-headless

  # Slower rate limit (more respectful)
  uv run scrape-apple-hig.py --delay 2.0
        """
    )

    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path(__file__).parent.parent / "packages/claude-plugin/data/hig",
        help="Output directory for HTML files (default: packages/claude-plugin/data/hig)",
    )
    parser.add_argument(
        "--start-url",
        default="https://developer.apple.com/design/human-interface-guidelines",
        help="Starting URL (default: HIG homepage)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay between requests in seconds (default: 1.0)",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Start fresh instead of resuming from previous run",
    )
    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="Show browser window (for debugging)",
    )

    args = parser.parse_args()

    # Validate start URL is a HIG URL
    if not is_hig_url(
        args.start_url,
        "https://developer.apple.com",
        "/design/human-interface-guidelines"
    ):
        print(f"Error: Start URL must be an Apple HIG URL", file=sys.stderr)
        print(f"Expected: https://developer.apple.com/design/human-interface-guidelines...", file=sys.stderr)
        print(f"Got: {args.start_url}", file=sys.stderr)
        sys.exit(1)

    print("=" * 80)
    print("Apple HIG Scraper")
    print("=" * 80)
    print(f"  Start URL: {args.start_url}")
    print(f"  Output: {args.output}")
    print(f"  Rate limit: {args.delay}s delay")
    print(f"  Resume: {not args.no_resume}")
    print(f"  Headless: {not args.no_headless}")
    print("=" * 80)
    print()

    stats = asyncio.run(crawl_hig(
        start_url=args.start_url,
        output_dir=args.output,
        rate_limit_delay=args.delay,
        resume=not args.no_resume,
        headless=not args.no_headless,
    ))

    print()
    print("=" * 80)
    print("SCRAPING COMPLETE")
    print("=" * 80)
    print(f"  Total pages: {stats.total_pages}")
    print(f"  Successful: {stats.successful}")
    print(f"  Failed: {stats.failed}")
    print(f"  Output: {args.output}")
    elapsed = time.time() - stats.start_time
    print(f"  Time: {elapsed:.0f}s ({elapsed/60:.1f} minutes)")
    print("=" * 80)


if __name__ == "__main__":
    main()
