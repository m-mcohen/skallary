"""Build the ICO and 256 px PNG from public/favicon.svg.

Install Pillow and resvg-py, then run python scripts/make-icon.py.
The standalone PNG and ICO use the SVG's default light-theme color.
"""
from io import BytesIO
from pathlib import Path

from PIL import Image
from resvg_py import svg_to_bytes


SIZES = [16, 24, 32, 48, 64, 128, 256]


def main() -> None:
    public = Path(__file__).resolve().parent.parent / "public"
    svg = (public / "favicon.svg").read_text(encoding="utf-8")
    frames = [
        Image.open(BytesIO(svg_to_bytes(svg_string=svg, width=size, height=size))).convert("RGBA")
        for size in SIZES
    ]
    frames[-1].save(
        public / "favicon.ico",
        format="ICO",
        sizes=[(size, size) for size in SIZES],
        append_images=frames[:-1],
    )
    frames[-1].save(public / "icon-256.png")


if __name__ == "__main__":
    main()
