"""Build Skallary's Windows and web app icons.

Install Pillow and resvg-py, then run python scripts/make-icon.py.
The small ICO frames use pixel coordinates; larger images use favicon.svg.
"""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
from resvg_py import svg_to_bytes


# Each grid defines a lower kernel pair, an upper pair and one terminal grain.
# The lower left kernel extends into the stem.
SMALL_CUTOUTS = {
    16: [
        [(4, 12), (5, 10), (4, 9), (4, 7), (5, 7), (6, 8), (6, 10), (5, 12)],
        [(7, 11), (8, 9), (11, 8), (10, 10), (9, 11)],
        [(7, 8), (6, 7), (6, 5), (7, 4), (8, 6), (8, 7)],
        [(9, 8), (10, 6), (12, 5), (12, 6), (11, 7)],
        [(9, 5), (9, 4), (11, 3), (11, 4)],
    ],
    20: [
        [(5, 16), (7, 13), (5, 12), (5, 9), (6, 9), (8, 11), (8, 13), (6, 16)],
        [(9, 14), (10, 12), (14, 10), (13, 13), (11, 14)],
        [(9, 10), (8, 9), (8, 6), (9, 5), (10, 7), (10, 9)],
        [(11, 10), (12, 8), (15, 6), (15, 8), (13, 10)],
        [(11, 6), (11, 5), (12, 4), (14, 3), (13, 5)],
    ],
    24: [
        [(6, 19), (8, 16), (6, 14), (6, 11), (8, 12), (10, 14), (10, 16), (8, 19)],
        [(11, 17), (12, 14), (17, 12), (16, 15), (14, 17)],
        [(11, 12), (9, 10), (9, 8), (11, 5), (11, 7), (13, 9), (13, 11)],
        [(14, 12), (15, 9), (19, 7), (18, 10), (16, 12)],
        [(13, 7), (14, 5), (17, 3), (16, 6), (15, 7)],
    ],
    32: [
        [(8, 26), (11, 21), (8, 19), (8, 15), (9, 14), (10, 16), (13, 18), (13, 21), (10, 26)],
        [(14, 23), (16, 19), (20, 18), (23, 16), (21, 20), (18, 23)],
        [(14, 16), (12, 14), (12, 11), (14, 7), (14, 10), (17, 12), (17, 14)],
        [(18, 16), (19, 13), (22, 11), (25, 8), (24, 12), (21, 15)],
        [(17, 9), (18, 6), (22, 4), (21, 7), (19, 9)],
    ],
    48: [
        [(12, 40), (16, 33), (12, 30), (11, 27), (12, 22), (14, 25), (18, 27), (20, 30), (19, 33), (15, 40)],
        [(21, 35), (23, 30), (27, 28), (31, 27), (35, 24), (32, 30), (28, 34), (24, 35)],
        [(21, 25), (18, 22), (17, 18), (18, 14), (21, 10), (21, 15), (24, 17), (26, 20), (25, 23)],
        [(27, 25), (29, 20), (33, 17), (38, 12), (36, 18), (32, 23)],
        [(26, 14), (27, 10), (30, 8), (34, 5), (32, 10), (29, 13)],
    ],
}
ICO_SIZES = [16, 20, 24, 32, 48, 64, 128, 256]
PNG_SIZES = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-256.png": 256,
    "icon-512.png": 512,
}
COIN = "#B77D31"


def small_icon(size: int) -> Image.Image:
    # Draw a smooth circle with exact one-pixel outer bounds, then punch out
    # the manually placed kernels on the final grid.
    circle = Image.new("L", (size * 8, size * 8))
    ImageDraw.Draw(circle).ellipse((8, 8, (size - 1) * 8 - 1, (size - 1) * 8 - 1), fill=255)
    circle = circle.resize((size, size), Image.Resampling.BOX)
    cutout = Image.new("L", (size, size))
    draw = ImageDraw.Draw(cutout)
    for kernel in SMALL_CUTOUTS[size]:
        draw.polygon(kernel, fill=255)
    icon = Image.new("RGBA", (size, size), COIN)
    icon.putalpha(ImageChops.subtract(circle, cutout))
    return icon


def render(svg: str, size: int) -> Image.Image:
    data = svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(BytesIO(data)).convert("RGBA")


def main() -> None:
    public = Path(__file__).resolve().parent.parent / "public"
    svg = (public / "favicon.svg").read_text(encoding="utf-8")
    frames = [
        small_icon(size) if size in SMALL_CUTOUTS else render(svg, size)
        for size in ICO_SIZES
    ]
    frames[-1].save(
        public / "favicon.ico",
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=frames[:-1],
    )
    for name, size in PNG_SIZES.items():
        render(svg, size).save(public / name)


if __name__ == "__main__":
    main()
