"""Generates synthetic book-page images for testing OCR + mark detection.
Usage: python test/make-fixtures.py <out_dir>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 34)

PAGES = {
    "cac_highlight.png": (
        ["Customer acquisition cost represents the total sales",
         "and marketing expenditure required to acquire a new",
         "customer. Understanding costs is essential when",
         "determining the profitability of a business."],
        {"highlight": [0, 1]},
    ),
    "compound_underline.png": (
        ["Compounding is the process by which small gains",
         "grow into enormous wealth over a long period of time.",
         "Patience matters more than the size of any return."],
        {"underline": [1]},
    ),
    "plain_pricing.png": (
        ["Pricing strategy depends on perceived value rather",
         "than the cost of production. A product is worth what",
         "customers are willing to pay for it."],
        {},
    ),
    "profit_equation.png": (
        ["The profit margin is calculated as follows:",
         "Profit = Revenue - Costs",
         "Divide profit by revenue to get the margin."],
        {},
    ),
}

for name, (lines, marks) in PAGES.items():
    img = Image.new("RGB", (1000, 150 + 70 * len(lines)), (250, 247, 240))
    d = ImageDraw.Draw(img)
    for i, text in enumerate(lines):
        y = 80 + 70 * i
        w = d.textlength(text, font=font)
        if i in marks.get("highlight", []):
            d.rectangle([60, y - 4, 60 + w + 8, y + 46], fill=(255, 235, 59))
        d.text((64, y), text, font=font, fill=(25, 25, 25))
        if i in marks.get("underline", []):
            d.line([64, y + 46, 64 + w, y + 46], fill=(0, 0, 0), width=3)
    img.save(out / name)
print("ok", out)
