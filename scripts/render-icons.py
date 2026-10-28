"""Render the BiliPlus geometric SVG into deterministic transparent PNG icons.

Usage: python scripts/render-icons.py
Requires Pillow >= 10. The SVG is the only geometric source; this renderer
intentionally accepts only the rect, line, polyline and polygon primitives
used by extension/common/brand.svg. It does not run a browser or use a network.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension" / "common" / "brand.svg"
TARGET = ROOT / "extension" / "icons"
SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 8


def color(value: str | None):
    return None if value is None or value == "none" else ImageColor.getcolor(value, "RGBA")


def draw_svg(size: int) -> Image.Image:
    svg = ET.fromstring(SOURCE.read_text(encoding="utf-8"))
    box = [float(v) for v in svg.attrib["viewBox"].split()]
    if box != [0, 0, 128, 128]:
        raise ValueError("Unexpected SVG viewBox; update renderer deliberately")
    canvas = Image.new("RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    scale = size * SUPERSAMPLE / 128

    def number(element, name, default=0):
        return float(element.attrib.get(name, default)) * scale

    def disk(point, radius, ink):
        x, y = point
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=ink)

    for element in svg:
        tag = element.tag.rsplit("}", 1)[-1]
        if tag in {"title", "desc"}:
            continue
        attrs = element.attrib
        fill, stroke = color(attrs.get("fill")), color(attrs.get("stroke"))
        width = number(element, "stroke-width", 1)
        if tag == "rect":
            x, y, w, h = (number(element, key) for key in ("x", "y", "width", "height"))
            radius = number(element, "rx")
            if stroke:
                inset = width / 2
                draw.rounded_rectangle((x - inset, y - inset, x + w + inset, y + h + inset), radius=radius + inset, fill=stroke)
                draw.rounded_rectangle((x + inset, y + inset, x + w - inset, y + h - inset), radius=max(0, radius - inset), fill=fill)
            else:
                draw.rounded_rectangle((x, y, x + w, y + h), radius=radius, fill=fill)
        elif tag in {"line", "polyline", "polygon"}:
            if tag == "line":
                points = [(number(element, "x1"), number(element, "y1")), (number(element, "x2"), number(element, "y2"))]
            else:
                coordinates = [float(v) * scale for v in re.findall(r"-?\d+(?:\.\d+)?", attrs["points"])]
                if len(coordinates) % 2:
                    raise ValueError("Invalid SVG points")
                points = list(zip(coordinates[::2], coordinates[1::2]))
            if tag == "polygon" and fill:
                draw.polygon(points, fill=fill)
            if stroke:
                draw.line(points, fill=stroke, width=max(1, round(width)), joint="curve")
                if attrs.get("stroke-linejoin") == "round":
                    for point in points[1:-1]:
                        disk(point, width / 2, stroke)
                if attrs.get("stroke-linecap") == "round":
                    disk(points[0], width / 2, stroke)
                    disk(points[-1], width / 2, stroke)
        else:
            raise ValueError(f"Unsupported SVG primitive: {tag}")
    return canvas.convert("RGBa").resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    report = {"source": str(SOURCE.relative_to(ROOT)), "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "icons": []}
    for size in SIZES:
        image = draw_svg(size)
        target = TARGET / f"icon{size}.png"
        image.save(target, format="PNG", compress_level=9, optimize=False)
        report["icons"].append({"path": str(target.relative_to(ROOT)), "size": [size, size], "mode": image.mode, "alphaExtrema": list(image.getchannel("A").getextrema()), "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
