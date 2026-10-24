"""Generates PDF fixtures for the reader tests (no extra libraries).
  book.pdf     12 pages of real text, metadata and a 3-chapter outline (one nested entry)
  scanned.pdf  3 image-only pages: no text layer, no outline
  fake.pdf     not a PDF at all
Usage: python test/make-pdfs.py <out_dir>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

WORDS = ("Pricing strategy depends on perceived value rather than the cost of production. "
         "Customers pay for outcomes, so a good price reflects the problem that is solved. "
         "Compounding rewards patience: small gains grow into enormous wealth over a long period. ").split()


def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_text_pdf(path):
    pages, chapters = 12, [("Chapter 1: Value", 1, None), ("Chapter 2: Price", 5, None), ("Chapter 3: Growth", 9, None)]
    objs = {}                                   # number -> bytes body
    page_nums = [6 + 2 * i for i in range(pages)]  # page object numbers; content = page + 1
    outline_nums = [6 + 2 * pages + i for i in range(len(chapters) + 1)]  # 3 chapters + 1 nested child
    objs[1] = b"<</Type/Catalog/Pages 2 0 R/Outlines 3 0 R>>"
    objs[2] = ("<</Type/Pages/Kids[" + " ".join(f"{n} 0 R" for n in page_nums) + f"]/Count {pages}>>").encode()
    objs[3] = f"<</Type/Outlines/First {outline_nums[0]} 0 R/Last {outline_nums[2]} 0 R/Count 4>>".encode()
    objs[4] = b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"
    objs[5] = b"<</Title(The Craft of Pricing)/Author(Test Author)>>"
    for i, n in enumerate(page_nums):
        lines = [f"Chapter heading for page {i + 1}"] + [" ".join(WORDS[(j * 7 + k) % len(WORDS)] for k in range(8)) for j in range(22)]
        stream = "BT /F1 12 Tf 14 TL 40 560 Td " + " T* ".join(f"({esc(t)}) Tj" for t in lines) + " ET"
        objs[n] = f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 595]/Contents {n + 1} 0 R/Resources<</Font<</F1 4 0 R>>>>>>".encode()
        objs[n + 1] = f"<</Length {len(stream)}>>\nstream\n{stream}\nendstream".encode()
    for i, (title, pg, _) in enumerate(chapters):
        n = outline_nums[i]
        parts = [f"/Title({esc(title)})", "/Parent 3 0 R", f"/Dest[{page_nums[pg - 1]} 0 R/Fit]"]
        if i > 0: parts.append(f"/Prev {outline_nums[i - 1]} 0 R")
        if i < 2: parts.append(f"/Next {outline_nums[i + 1]} 0 R")
        if i == 1: parts += [f"/First {outline_nums[3]} 0 R/Last {outline_nums[3]} 0 R/Count 1"]
        objs[n] = ("<<" + "".join(parts) + ">>").encode()
    objs[outline_nums[3]] = f"<</Title(Section 2.1: Discounts)/Parent {outline_nums[1]} 0 R/Dest[{page_nums[6 - 1]} 0 R/Fit]>>".encode()
    buf = bytearray(b"%PDF-1.4\n")
    offs = {}
    for n in sorted(objs):
        offs[n] = len(buf)
        buf += f"{n} 0 obj\n".encode() + objs[n] + b"\nendobj\n"
    x = len(buf)
    top = max(objs) + 1
    buf += f"xref\n0 {top}\n".encode() + b"0000000000 65535 f \n"
    for n in range(1, top):
        buf += f"{offs[n]:010d} 00000 n \n".encode()
    buf += f"trailer\n<</Size {top}/Root 1 0 R/Info 5 0 R>>\nstartxref\n{x}\n%%EOF\n".encode()
    path.write_bytes(bytes(buf))


def build_scanned(path):
    font = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 30)
    imgs = []
    for i in range(3):
        im = Image.new("RGB", (800, 1100), (246, 242, 232))
        d = ImageDraw.Draw(im)
        for j in range(12):
            d.text((60, 80 + j * 70), f"Scanned page {i + 1}, line {j + 1}: handwritten notes in the margin", font=font, fill=(40, 40, 40))
        imgs.append(im)
    imgs[0].save(path, save_all=True, append_images=imgs[1:], resolution=100)


build_text_pdf(out / "book.pdf")
build_scanned(out / "scanned.pdf")
(out / "fake.pdf").write_text("This is just text pretending to be a PDF.\n")
print("ok", out)
