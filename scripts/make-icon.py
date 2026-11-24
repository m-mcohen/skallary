"""Rasterize the app icon ("Columns at dawn") into public/favicon.ico.

The geometry mirrors public/favicon.svg on a 24-unit grid. Each size is drawn
at 8x and downsampled so the 16px tab icon keeps clean edges instead of the
smeared result a single resize of a 256px master gives. Pillow only; no SVG
renderer needed on Windows.

    python scripts/make-icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

INK = (0x14, 0x16, 0x1A, 255)
PAPER = (0xF4, 0xF4, 0xF5, 255)
SIZES = [16, 24, 32, 48, 64, 128, 256]
SS = 8  # supersample factor


def draw(size: int) -> Image.Image:
    px = size * SS
    k = px / 24.0
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, px - 1, px - 1), radius=5.2 * k, fill=INK)
    cx, cy, r = 7.2 * k, 7.4 * k, 3.1 * k
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PAPER)
    for x, y, w, h in ((4.2, 14.4, 3.6, 5.8), (10.2, 10.6, 3.6, 9.6), (16.2, 5.2, 3.6, 15.0)):
        d.rounded_rectangle((x * k, y * k, (x + w) * k, (y + h) * k), radius=0.8 * k, fill=PAPER)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public"
    frames = [draw(s) for s in SIZES]
    frames[-1].save(out / "favicon.ico", format="ICO", sizes=[(s, s) for s in SIZES],
                    append_images=frames[:-1])
    frames[-1].save(out / "icon-256.png")
    print("wrote", out / "favicon.ico", "and icon-256.png", SIZES)


if __name__ == "__main__":
    main()
