#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "playwright",
#     "beautifulsoup4",
#     "lxml",
#     "html2text",
#     "markdownify",
# ]
# ///
"""
Apple HIG HTML to Markdown Converter

Processes downloaded HIG HTML files and converts them to clean Markdown format.

Usage:
    uv run process-to-markdown.py [--input DIR] [--output DIR]

Example:
    # Process all HTML files
    uv run process-to-markdown.py

    # Custom directories
    uv run process-to-markdown.py --input data --output markdown
"""

import asyncio
import sys
from argparse import ArgumentParser
from pathlib import Path
from bs4 import BeautifulSoup
from markdownify import markdownify as md

def extract_content_from_html(html_content: str, url: str) -> tuple[str, str, str]:
    """
    Extract meaningful content from HIG HTML.

    Returns:
        tuple: (title, description, markdown_content)
    """
    soup = BeautifulSoup(html_content, 'lxml')

    # Extract metadata
    title_tag = soup.find('title')
    title = title_tag.get_text() if title_tag else "Untitled"

    desc_tag = soup.find('meta', attrs={'name': 'description'})
    description = desc_tag.get('content', '') if desc_tag else ""

    # The HIG pages are Vue.js SPAs, so we need to render them with a headless browser
    # or extract from the initial state. For now, we'll include metadata and note
    # that full content requires browser rendering.

    # Try to find any visible content in noscript or initial render
    # Most content is dynamically loaded, so we'll create a simple markdown with metadata

    markdown = f"# {title}\n\n"
    markdown += f"**Description**: {description}\n\n"
    markdown += f"**Source**: {url}\n\n"
    markdown += "---\n\n"
    markdown += "*Note: This page uses dynamic content loading. "
    markdown += "For full content, please visit the source URL or view the HTML file directly.*\n\n"

    return title, description, markdown


async def process_html_with_browser(html_path: Path, url: str) -> tuple[str, str, str]:
    """
    Process HTML using Playwright to render the page and extract content.

    Returns:
        tuple: (title, description, markdown_content)
    """
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Load the HTML file
        await page.goto(f"file://{html_path.absolute()}", wait_until="networkidle")

        # Wait for content to render
        await page.wait_for_timeout(2000)

        # Extract title
        title = await page.title()

        # Extract meta description
        desc_element = await page.query_selector('meta[name="description"]')
        description = await desc_element.get_attribute('content') if desc_element else ""

        # Extract main content
        # HIG pages typically have main content in specific containers
        main_content = await page.query_selector('main, [role="main"], article')

        if main_content:
            html_content = await main_content.inner_html()
            # Convert to markdown
            markdown_content = md(html_content, heading_style="ATX")
        else:
            # Fallback to body
            body_html = await page.evaluate('document.body.innerHTML')
            markdown_content = md(body_html, heading_style="ATX")

        await browser.close()

        # Clean up the markdown
        markdown = f"# {title}\n\n"
        markdown += f"> {description}\n\n" if description else ""
        markdown += f"**Source**: [{url}]({url})\n\n"
        markdown += "---\n\n"
        markdown += markdown_content

        return title, description, markdown


def process_file_simple(html_path: Path, url: str, output_path: Path):
    """Simple processing without browser rendering."""
    try:
        html_content = html_path.read_text(encoding='utf-8')
        title, description, markdown = extract_content_from_html(html_content, url)

        # Write markdown file
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding='utf-8')

        print(f"[OK] {html_path.relative_to(html_path.parent.parent.parent)} -> {output_path.name}")
        return True
    except Exception as e:
        print(f"[FAIL] {html_path}: {e}", file=sys.stderr)
        return False


async def process_file_with_browser(html_path: Path, url: str, output_path: Path):
    """Full processing with browser rendering."""
    try:
        title, description, markdown = await process_html_with_browser(html_path, url)

        # Write markdown file
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding='utf-8')

        print(f"[OK] {html_path.relative_to(html_path.parent.parent.parent)} -> {output_path.name}")
        return True
    except Exception as e:
        print(f"[FAIL] {html_path}: {e}", file=sys.stderr)
        return False


async def process_all_files(input_dir: Path, output_dir: Path, use_browser: bool = True):
    """Process all HTML files in the input directory."""

    # Find all HTML files
    html_files = list(input_dir.rglob("*.html"))
    print(f"Found {len(html_files)} HTML files to process")

    success_count = 0
    fail_count = 0

    for html_file in html_files:
        # Skip .visited.json metadata files
        if html_file.name == '.visited.json':
            continue

        # Determine relative path
        rel_path = html_file.relative_to(input_dir)

        # Create output path (replace .html with .md)
        output_file = output_dir / rel_path.with_suffix('.md')

        # Construct URL
        topic_path = str(rel_path.parent).replace('\\', '/')
        if topic_path == '.':
            url = "https://developer.apple.com/design/human-interface-guidelines"
        else:
            url = f"https://developer.apple.com/design/human-interface-guidelines/{topic_path}"

        # Process file
        if use_browser:
            result = await process_file_with_browser(html_file, url, output_file)
        else:
            result = process_file_simple(html_file, url, output_file)

        if result:
            success_count += 1
        else:
            fail_count += 1

    print(f"\n=== Summary ===")
    print(f"Total: {len(html_files)}")
    print(f"Success: {success_count}")
    print(f"Failed: {fail_count}")


def main():
    """Main entry point."""
    parser = ArgumentParser(description="Convert HIG HTML files to Markdown")
    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        default=Path(__file__).parent / "data",
        help="Input directory containing HTML files (default: data/)"
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path(__file__).parent / "markdown",
        help="Output directory for Markdown files (default: markdown/)"
    )
    parser.add_argument(
        "--simple",
        action="store_true",
        help="Use simple processing (metadata only, no browser rendering)"
    )

    args = parser.parse_args()

    print("=" * 80)
    print("Apple HIG HTML to Markdown Converter")
    print("=" * 80)
    print(f"Input:  {args.input}")
    print(f"Output: {args.output}")
    print(f"Mode:   {'Simple (metadata only)' if args.simple else 'Full (with browser)'}")
    print("=" * 80)
    print()

    # Create output directory
    args.output.mkdir(parents=True, exist_ok=True)

    # Process files
    asyncio.run(process_all_files(args.input, args.output, use_browser=not args.simple))


if __name__ == "__main__":
    main()
