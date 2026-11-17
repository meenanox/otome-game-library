"""Generates icon.png and icon.ico: a cute pink game controller."""
from PIL import Image, ImageDraw, ImageFilter
import os

S = 1024
WINGS = False  # set True for the Cardcaptor-wing version
out = os.path.dirname(os.path.abspath(__file__))

def layer():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))

def body_mask(inset=0, dy=0):
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    # main bar + two grips
    d.rounded_rectangle((90 + inset, 260 + inset + dy, 934 - inset, 700 - inset + dy), radius=210, fill=255)
    d.ellipse((90 + inset, 420 + inset + dy, 400 - inset, 880 - inset + dy), fill=255)
    d.ellipse((624 + inset, 420 + inset + dy, 934 - inset, 880 - inset + dy), fill=255)
    return m

img = layer()
# soft shadow
sh = Image.new("RGBA", (S, S), (150, 40, 100, 0))
sh.putalpha(body_mask(dy=30).filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * .35)))
img = Image.alpha_composite(img, sh)


# outline, body, highlight
for inset, color in ((0, (214, 80, 140, 255)), (14, (255, 143, 190, 255))):
    c = Image.new("RGBA", (S, S), color)
    c.putalpha(body_mask(inset))
    img = Image.alpha_composite(img, c)
# lighter belly gradient
hl = Image.new("RGBA", (S, S), (255, 190, 220, 255))
m = Image.new("L", (S, S), 0)
ImageDraw.Draw(m).rounded_rectangle((170, 290, 854, 420), radius=60, fill=150)
m = m.filter(ImageFilter.GaussianBlur(25))
bm = body_mask(14)
m = Image.composite(m, Image.new("L", (S, S), 0), bm)
hl.putalpha(m)
img = Image.alpha_composite(img, hl)

d = ImageDraw.Draw(img)
# d-pad
cx, cy, a, t = 285, 420, 78, 54
dark = (190, 60, 120, 255)
for off, col in ((8, dark), (0, (255, 255, 255, 255))):
    d.rounded_rectangle((cx - a, cy - t // 2 + off, cx + a, cy + t // 2 + off), radius=18, fill=col)
    d.rounded_rectangle((cx - t // 2, cy - a + off, cx + t // 2, cy + a + off), radius=18, fill=col)

# face buttons
for (bx, by, col) in ((745, 365, (255, 236, 130, 255)), (815, 435, (150, 220, 255, 255)),
                      (675, 435, (190, 255, 200, 255)), (745, 505, (255, 255, 255, 255))):
    d.ellipse((bx - 36, by - 36 + 7, bx + 36, by + 36 + 7), fill=dark)
    d.ellipse((bx - 36, by - 36, bx + 36, by + 36), fill=col)

# cute face between the sticks
ink = (110, 30, 70, 255)
for ex in (440, 584):
    d.ellipse((ex - 30, 440, ex + 30, 520), fill=ink)
    d.ellipse((ex - 6, 452, ex + 16, 474), fill=(255, 255, 255, 255))
d.arc((470, 490, 554, 550), 20, 160, fill=ink, width=12)
for bx in (385, 639):
    blush = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(blush).ellipse((bx - 40, 520, bx + 40, 565), fill=(255, 90, 150, 140))
    img = Image.alpha_composite(img, blush)
d = ImageDraw.Draw(img)


if WINGS:
    # ---- compose: shrink the controller to leave room for side wings ----
    import math
    body = img
    SC = 0.64
    small = body.resize((int(S * SC), int(S * SC)), Image.LANCZOS)
    BX, BY = (S - small.width) // 2, 170

    def bez(p0, p1, p2, p3=None, n=24):
        pts = []
        for i in range(n + 1):
            t = i / n
            if p3 is None:
                x = (1-t)**2*p0[0] + 2*(1-t)*t*p1[0] + t*t*p2[0]
                y = (1-t)**2*p0[1] + 2*(1-t)*t*p1[1] + t*t*p2[1]
            else:
                x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t*t*p2[0] + t**3*p3[0]
                y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t*t*p2[1] + t**3*p3[1]
            pts.append((x, y))
        return pts

    def wing_layer(ox, oy, k, rot=-22, ky=1.35):
        """Cardcaptor-style wing sweeping to the right of (ox, oy)."""
        cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        T = lambda pts: [(ox + (x * cr - y * ky * sr) * k, oy + (x * sr + y * ky * cr) * k) for x, y in pts]
        P = []
        P += bez((0, -30), (100, -70), (230, -55), (305, -8), 30)   # long top edge to tip 1
        P += bez((305, -8), (250, 0), (225, 8), (200, 18), 14)       # tip 1 -> notch 1
        P += bez((200, 18), (240, 18), (270, 30), (272, 50), 14)     # -> tip 2
        P += bez((272, 50), (225, 52), (195, 55), (168, 62), 14)     # -> notch 2
        P += bez((168, 62), (205, 66), (232, 78), (228, 96), 14)     # -> tip 3
        P += bez((228, 96), (180, 108), (110, 112), (60, 108), 20)   # bottom edge
        P += bez((60, 108), (20, 105), (-5, 70), (0, -30), 20)       # rounded base
        pts = T(P)
        w = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(w)
        ink = (222, 170, 210, 255)
        d.polygon(pts, fill=(255, 255, 255, 255))
        d.line(pts + [pts[0]], fill=ink, width=int(20 * k), joint="curve")
        for p in (bez((200, 18), (150, 18), (110, 8), n=16), bez((168, 62), (130, 62), (100, 56), n=16)):
            d.line(T(p), fill=ink, width=int(12 * k), joint="curve")
        sp = []
        for i in range(60):
            t = i / 59
            ang = math.radians(210 + t * 480)
            r = 32 * (1 - t) + 4
            sp.append((70 + math.cos(ang) * r, 62 + math.sin(ang) * r))
        d.line(T(sp), fill=ink, width=int(13 * k), joint="curve")
        return w

    K = 0.8
    right = wing_layer(BX + small.width - 50, 430, K)
    from PIL import ImageOps
    left = ImageOps.mirror(right)
    final = layer()
    final = Image.alpha_composite(final, right)
    final = Image.alpha_composite(final, left)
    final.alpha_composite(small, (BX, BY))
    img = final
    d = ImageDraw.Draw(img)

    def sparkle(x, y, r, col):
        d.polygon([(x, y - r), (x + r * .28, y - r * .28), (x + r, y), (x + r * .28, y + r * .28),
                   (x, y + r), (x - r * .28, y + r * .28), (x - r, y), (x - r * .28, y - r * .28)], fill=col)
    sparkle(930, 330, 36, (255, 240, 150, 255))
    sparkle(94, 330, 30, (255, 240, 150, 255))


else:
    d = ImageDraw.Draw(img)
    for x0 in (170, 654):  # shoulder bumpers
        d.rounded_rectangle((x0, 205, x0 + 200, 270), radius=30, fill=(214, 80, 140, 255))
    def sparkle(x, y, r, col):
        d.polygon([(x, y - r), (x + r * .28, y - r * .28), (x + r, y), (x + r * .28, y + r * .28),
                   (x, y + r), (x - r * .28, y + r * .28), (x - r, y), (x - r * .28, y - r * .28)], fill=col)
    sparkle(880, 230, 70, (255, 240, 150, 255))
    sparkle(160, 200, 45, (255, 255, 255, 255))

if WINGS:
    bbox = img.getbbox()
    crop = img.crop(bbox)
    f = min(960 / crop.width, 960 / crop.height)
    crop = crop.resize((int(crop.width * f), int(crop.height * f)), Image.LANCZOS)
    img = layer()
    img.alpha_composite(crop, ((S - crop.width) // 2, (S - crop.height) // 2))
img.save(os.path.join(out, "icon.png"))
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
img.save(os.path.join(out, "icon.ico"), sizes=sizes)
print("done")
