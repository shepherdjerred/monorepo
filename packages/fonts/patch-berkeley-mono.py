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
    uvx patch-berkeley-mono.py <input_dir> [output_dir]

Example:
    uvx patch-berkeley-mono.py ~/Downloads/berkeley-ttf ~/Downloads/patched

Requirements:
    - fontforge must be installed: brew install fontforge
    - Nerd Fonts FontPatcher must be downloaded
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from fontTools.ttLib import TTFont


def download_font_patcher(dest_dir: Path) -> Path:
    """Download Nerd Fonts FontPatcher if not present."""
    patcher_dir = dest_dir / "nerd-fonts-patcher"
    patcher_script = patcher_dir / "font-patcher"

    if patcher_script.exists():
        print(f"FontPatcher already exists at {patcher_dir}")
        return patcher_dir

    print("Downloading Nerd Fonts FontPatcher...")
    zip_path = dest_dir / "FontPatcher.zip"

    subprocess.run([
        "curl", "-L", "-o", str(zip_path),
        "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/FontPatcher.zip"
    ], check=True)

    print("Extracting FontPatcher...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(patcher_dir)

    zip_path.unlink()
    return patcher_dir


def check_fontforge():
    """Check if fontforge is installed."""
    if shutil.which("fontforge") is None:
        print("ERROR: fontforge is not installed.")
        print("Install it with: brew install fontforge")
        sys.exit(1)


def fix_font_names(font_path: Path, style: str):
    """Fix internal font names to 'Berkeley Mono'."""
    font = TTFont(font_path)

    for record in font['name'].names:
        if record.nameID == 1:  # Family
            record.string = 'Berkeley Mono'
        elif record.nameID == 2:  # Subfamily
            record.string = style
        elif record.nameID == 4:  # Full name
            record.string = f'Berkeley Mono {style}'
        elif record.nameID == 6:  # PostScript name
            record.string = f'BerkeleyMono-{style.replace(" ", "")}'
        elif record.nameID == 16:  # Typographic Family
            record.string = 'Berkeley Mono'
        elif record.nameID == 17:  # Typographic Subfamily
            record.string = style

    font.save(font_path)


def patch_font(font_path: Path, patcher_dir: Path, output_dir: Path) -> Path:
    """Patch a single font with Nerd Fonts glyphs."""
    print(f"Patching: {font_path.name}")

    result = subprocess.run([
        "fontforge", "-script", str(patcher_dir / "font-patcher"),
        str(font_path),
        "--complete", "--mono",
        "--outputdir", str(output_dir)
    ], capture_output=True, text=True, cwd=patcher_dir)

    if result.returncode != 0:
        print(f"ERROR patching {font_path.name}:")
        print(result.stderr)
        return None

    # Find the output file
    for line in result.stdout.split('\n'):
        if "===>" in line:
            output_path = line.split("'")[1]
            return Path(output_path)

    return None


def main():
    parser = argparse.ArgumentParser(
        description="Patch Berkeley Mono TTF fonts with Nerd Fonts glyphs"
    )
    parser.add_argument("input_dir", help="Directory containing Berkeley Mono TTF files")
    parser.add_argument("output_dir", nargs="?", default="./patched",
                        help="Output directory (default: ./patched)")
    parser.add_argument("--install", action="store_true",
                        help="Install fonts to ~/Library/Fonts after patching")
    parser.add_argument("--zip", action="store_true",
                        help="Create a zip file of patched fonts")
    args = parser.parse_args()

    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not input_dir.exists():
        print(f"ERROR: Input directory does not exist: {input_dir}")
        sys.exit(1)

    # Find TTF files
    ttf_files = list(input_dir.glob("*.ttf"))
    if not ttf_files:
        # Check subdirectories
        ttf_files = list(input_dir.rglob("*.ttf"))

    if not ttf_files:
        print(f"ERROR: No TTF files found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(ttf_files)} TTF files:")
    for f in ttf_files:
        print(f"  - {f.name}")
    print()

    check_fontforge()

    # Setup
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = Path.home() / ".cache" / "nerd-fonts-patcher"
    cache_dir.mkdir(parents=True, exist_ok=True)
    patcher_dir = download_font_patcher(cache_dir)

    # Style mapping based on filename
    style_map = {
        'regular': 'Regular',
        'bold': 'Bold',
        'oblique': 'Oblique',
        'italic': 'Italic',
        'boldoblique': 'Bold Oblique',
        'bold-oblique': 'Bold Oblique',
        'bolditalic': 'Bold Italic',
        'bold-italic': 'Bold Italic',
    }

    patched_files = []

    for ttf_file in ttf_files:
        result = patch_font(ttf_file, patcher_dir, output_dir)
        if result and result.exists():
            # Determine style from filename
            name_lower = ttf_file.stem.lower()
            style = 'Regular'
            for key, value in style_map.items():
                if key in name_lower:
                    style = value
                    break

            # Rename to original naming convention
            new_name = f"BerkeleyMono-{style.replace(' ', '-')}.ttf"
            new_path = output_dir / new_name

            if result != new_path:
                shutil.move(result, new_path)

            # Fix internal font names
            fix_font_names(new_path, style)
            patched_files.append(new_path)
            print(f"  -> {new_name}")

    print()
    print(f"Patched {len(patched_files)} fonts to {output_dir}")

    # Create zip if requested
    if args.zip:
        zip_path = output_dir.parent / "BerkeleyMono-NerdFont.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in patched_files:
                zf.write(f, f.name)
        print(f"Created: {zip_path}")

    # Install if requested
    if args.install:
        fonts_dir = Path.home() / "Library" / "Fonts"
        for f in patched_files:
            dest = fonts_dir / f.name
            shutil.copy(f, dest)
            print(f"Installed: {dest}")
        subprocess.run(["fc-cache", "-f"], capture_output=True)
        print("Font cache refreshed")

    print()
    print("Done!")


if __name__ == "__main__":
    main()
