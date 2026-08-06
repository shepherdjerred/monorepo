#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "fonttools>=4.50.0",
# ]
# ///
"""
Patch Berkeley Mono TTF fonts with Nerd Fonts glyphs.

Usage:
    uv run patch-berkeley-mono.py <input_dir> [output_dir]

Example:
    uv run patch-berkeley-mono.py ~/Downloads/berkeley-ttf ~/Downloads/patched

Requirements:
    - fontforge must be installed: brew install fontforge
    - curl must be installed
"""

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from fontTools.ttLib import TTFont

# renovate: datasource=github-releases depName=ryanoasis/nerd-fonts
NERD_FONTS_VERSION = "v3.5.0"
FONT_PATCHER_SHA256 = "bcc707177d95cfee99fcc50ac3ae01a844372a6a4b66c12b7d4423563951feef"
FONT_PATCHER_URL = f"https://github.com/ryanoasis/nerd-fonts/releases/download/{NERD_FONTS_VERSION}/FontPatcher.zip"


def sha256(path: Path) -> str:
    """Return the SHA-256 digest for a file."""
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_zip(archive: Path, destination: Path) -> None:
    """Extract a zip archive after rejecting paths outside the destination."""
    destination_root = destination.resolve()
    with zipfile.ZipFile(archive, "r") as zip_file:
        for member in zip_file.infolist():
            member_path = (destination / member.filename).resolve()
            if not member_path.is_relative_to(destination_root):
                raise ValueError(f"Archive member escapes destination: {member.filename}")
        zip_file.extractall(destination)


def download_font_patcher(dest_dir: Path) -> Path:
    """Download and verify the pinned Nerd Fonts FontPatcher release."""
    patcher_dir = dest_dir / NERD_FONTS_VERSION
    patcher_script = patcher_dir / "font-patcher"
    zip_path = dest_dir / f"FontPatcher-{NERD_FONTS_VERSION}.zip"

    if patcher_script.exists():
        print(f"FontPatcher already exists at {patcher_dir}")
        return patcher_dir

    if not zip_path.exists():
        print(f"Downloading Nerd Fonts FontPatcher {NERD_FONTS_VERSION}...")
        subprocess.run(["curl", "-fL", "-o", str(zip_path), FONT_PATCHER_URL], check=True)

    actual_sha256 = sha256(zip_path)
    if actual_sha256 != FONT_PATCHER_SHA256:
        raise ValueError(f"FontPatcher checksum mismatch: expected {FONT_PATCHER_SHA256}, got {actual_sha256}")

    print("Extracting FontPatcher...")
    patcher_dir.mkdir(parents=True)
    extract_zip(zip_path, patcher_dir)

    if not patcher_script.is_file():
        raise FileNotFoundError(f"FontPatcher archive is missing {patcher_script.name}")
    return patcher_dir


def require_tool(tool: str) -> None:
    """Fail when a required executable is unavailable."""
    if shutil.which(tool) is None:
        raise FileNotFoundError(f"Required tool is not installed: {tool}")


def fix_font_names(font_path: Path, style: str) -> None:
    """Fix internal font names to 'Berkeley Mono'."""
    font = TTFont(font_path)
    try:
        for record in font["name"].names:
            value: str | None = None
            if record.nameID == 1:  # Family
                value = "Berkeley Mono"
            elif record.nameID == 2:  # Subfamily
                value = style
            elif record.nameID == 4:  # Full name
                value = f"Berkeley Mono {style}"
            elif record.nameID == 6:  # PostScript name
                value = f"BerkeleyMono-{style.replace(' ', '')}"
            elif record.nameID == 16:  # Typographic Family
                value = "Berkeley Mono"
            elif record.nameID == 17:  # Typographic Subfamily
                value = style

            if value is not None:
                encoding = record.getEncoding()
                if encoding is None:
                    raise ValueError(f"Font name record {record.nameID} has no text encoding")
                record.string = value.encode(encoding)

        font.save(font_path)
    finally:
        font.close()


def font_style(font_path: Path) -> str:
    """Derive a Berkeley Mono style name from a static font filename."""
    prefix = "BerkeleyMono-"
    if not font_path.stem.startswith(prefix):
        raise ValueError(f"Unexpected Berkeley Mono filename: {font_path.name}")

    style = font_path.stem.removeprefix(prefix).replace("-", " ")
    if not style:
        raise ValueError(f"Berkeley Mono filename has no style: {font_path.name}")
    return style


def patch_font(font_path: Path, patcher_dir: Path, output_dir: Path) -> Path:
    """Patch a single font with Nerd Fonts glyphs."""
    print(f"Patching: {font_path.name}")

    with tempfile.TemporaryDirectory(prefix="berkeley-mono-", dir=output_dir) as temp:
        temp_dir = Path(temp)
        result = subprocess.run(
            [
                "fontforge",
                "-script",
                str(patcher_dir / "font-patcher"),
                str(font_path),
                "--complete",
                "--mono",
                "--outputdir",
                str(temp_dir),
            ],
            capture_output=True,
            text=True,
            cwd=patcher_dir,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"FontPatcher failed for {font_path.name}:\n{result.stderr}")

        generated_files = sorted(temp_dir.glob("*.ttf"))
        if len(generated_files) != 1:
            raise RuntimeError(f"Expected one patched TTF for {font_path.name}, found {len(generated_files)}")

        style = font_style(font_path)
        output_path = output_dir / f"BerkeleyMono-{style.replace(' ', '-')}.ttf"
        generated_files[0].replace(output_path)

    fix_font_names(output_path, style)
    print(f"  -> {output_path.name}")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Patch Berkeley Mono TTF fonts with Nerd Fonts glyphs")
    parser.add_argument("input_dir", help="Directory containing Berkeley Mono TTF files")
    parser.add_argument(
        "output_dir",
        nargs="?",
        default="./patched",
        help="Output directory (default: ./patched)",
    )
    parser.add_argument(
        "--install",
        action="store_true",
        help="Install fonts to ~/Library/Fonts after patching",
    )
    parser.add_argument("--zip", action="store_true", help="Create a zip file of patched fonts")
    args = parser.parse_args()

    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not input_dir.is_dir():
        print(f"ERROR: Input directory does not exist: {input_dir}")
        sys.exit(1)

    # Find TTF files
    ttf_files = sorted(input_dir.glob("*.ttf"))
    if not ttf_files:
        # Check subdirectories
        ttf_files = sorted(input_dir.rglob("*.ttf"))

    if not ttf_files:
        print(f"ERROR: No TTF files found in {input_dir}")
        sys.exit(1)

    for ttf_file in ttf_files:
        font_style(ttf_file)

    print(f"Found {len(ttf_files)} TTF files:")
    for f in ttf_files:
        print(f"  - {f.name}")
    print()

    require_tool("curl")
    require_tool("fontforge")

    # Setup
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = Path.home() / ".cache" / "nerd-fonts-patcher"
    cache_dir.mkdir(parents=True, exist_ok=True)
    patcher_dir = download_font_patcher(cache_dir)

    patched_files: list[Path] = []

    for ttf_file in ttf_files:
        patched_files.append(patch_font(ttf_file, patcher_dir, output_dir))

    print()
    print(f"Patched {len(patched_files)} fonts to {output_dir}")

    # Create zip if requested
    if args.zip:
        zip_path = output_dir.parent / "BerkeleyMono-NerdFont.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for f in patched_files:
                zip_file.write(f, f.name)
        print(f"Created: {zip_path}")

    # Install if requested
    if args.install:
        fonts_dir = Path.home() / "Library" / "Fonts"
        fonts_dir.mkdir(parents=True, exist_ok=True)
        for f in patched_files:
            dest = fonts_dir / f.name
            shutil.copy(f, dest)
            print(f"Installed: {dest}")

    print("\nDone!")


if __name__ == "__main__":
    main()
