import argparse
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont


def text_path(font_path: Path, text: str, x: float, y: float, size: float, tracking: float) -> str:
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    cursor = x
    parts: list[str] = []
    for index, char in enumerate(text):
        name = cmap.get(ord(char))
        if name is None:
            raise KeyError(f"missing glyph {char!r} in {font_path.name}")
        glyph = glyph_set[name]
        pen = SVGPathPen(glyph_set)
        transformed = TransformPen(pen, (scale, 0, 0, -scale, cursor, y))
        glyph.draw(transformed)
        path = pen.getCommands()
        if path:
            parts.append(path)
        cursor += glyph.width * scale
        if index < len(text) - 1:
            cursor += tracking
    return " ".join(parts)


parser = argparse.ArgumentParser()
parser.add_argument("--font", required=True)
parser.add_argument("--text", required=True)
parser.add_argument("--x", type=float, required=True)
parser.add_argument("--y", type=float, required=True)
parser.add_argument("--size", type=float, required=True)
parser.add_argument("--tracking", type=float, default=0)
args = parser.parse_args()
print(text_path(Path(args.font), args.text, args.x, args.y, args.size, args.tracking), end="")
