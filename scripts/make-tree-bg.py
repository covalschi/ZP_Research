# -*- coding: utf-8 -*-
# Задники вікна дерева досліджень — по одному на фракцію.
#
# Три обмеження, з яких випливає весь вигляд:
#  1. Рушій НЕ приглушує цю картинку (перевірено живцем: ні color у розмітці, ні SetColor,
#     ні SetAlpha на неї не діють — коментар у ZP_TreeMenu.c). Отже, затемнення й прозорість
#     емблеми мають бути вже впечені у файл: підписи вузлів читаються по непрозорих картках,
#     а тло має лишатися глухим.
#  2. Віджет TreeBgImage — 700x558 одиниць розмітки зі "stretch mode stretch_w_h", тобто
#     картинка РОЗТЯГУЄТЬСЯ до співвідношення 1.2545:1 без збереження пропорцій. Полотно
#     квадратне (вимога PAA — сторони степені двійки), тож емблему малюємо заздалегідь
#     СТИСНУТОЮ по горизонталі на 1/1.2545, і після розтягу вона стає круглою.
#  3. Стеля яскравості ~110/255: світліше тло з'їдає білий текст карток вузлів.
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance, ImageStat

# Шляхи — відносно кореня репозиторію (скрипт запускається звідки завгодно).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(_ROOT, 'assets', 'tree-emblems') + os.sep   # вихідні нашивки (див. gui/textures/tree/SOURCES.md)
OUT = os.path.join(_ROOT, 'build', 'tree-bg-out') + os.sep     # PNG; у PAA конвертує ImageToPAA.exe
os.makedirs(OUT, exist_ok=True)

SIZE = 1024
ASPECT = 700.0 / 558.0
SQUASH = 1.0 / ASPECT
CEIL = 110          # стеля яскравості

FACTIONS = {
    'ecolog':   ('ecolog.png',   (46, 132, 148)),
    'clearsky': ('clearsky.png', (56, 118, 176)),
    'duty':     ('duty.png',     (150, 46, 46)),
    'freedom':  ('freedom.png',  (52, 128, 70)),
    'sop':      ('sop.png',      (146, 102, 40)),
    'bandit':   ('bandit.png',   (92, 92, 100)),
    'loner':    ('loner.png',    (150, 116, 48)),
}


def radial_mask(size, inner=0.05, outer=0.72):
    """1 у центрі, 0 до країв. Один еліпс + розмиття замість купи вкладених."""
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    r = size * outer / 2.0
    d.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], fill=255)
    return m.filter(ImageFilter.GaussianBlur(size * 0.16))


def grain(size, seed):
    """Детермінований дрібний шум (без numpy: перезбірка дає ті самі байти)."""
    small = Image.new('L', (size // 8, size // 8))
    px = small.load()
    state = seed & 0x7FFFFFFF
    for y in range(small.size[1]):
        for x in range(small.size[0]):
            state = (1103515245 * state + 12345) & 0x7FFFFFFF
            px[x, y] = 120 + (state >> 16) % 20
    return small.resize((size, size), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.1))


def build(fac, emblem_file, tint):
    # 1) основа: глухий графіт + тонований радіальний підсвіт кольором фракції
    base = Image.new('RGB', (SIZE, SIZE), (13, 15, 19))
    glow = Image.new('RGB', (SIZE, SIZE), tint)
    glow = ImageEnhance.Brightness(glow).enhance(0.42)
    base = Image.composite(glow, base, radial_mask(SIZE))

    # 2) зерно
    g = grain(SIZE, sum(ord(c) for c in fac) * 7919)
    base = ImageChops.multiply(base, Image.merge('RGB', (g, g, g)))
    base = ImageEnhance.Brightness(base).enhance(1.35)

    # 3) емблема: стиснута по горизонталі, знебарвлена, напівпрозора, з м'якою тінню
    em = Image.open(SRC + emblem_file).convert('RGBA')
    target_h = int(SIZE * 0.58)
    scale = target_h / float(em.size[1])
    em = em.resize((max(1, int(em.size[0] * scale * SQUASH)), target_h), Image.LANCZOS)
    em = ImageEnhance.Color(em).enhance(0.65)
    em = ImageEnhance.Brightness(em).enhance(1.05)
    em.putalpha(em.split()[3].point(lambda p: int(p * 0.62)))

    shadow = Image.new('RGBA', em.size, (0, 0, 0, 0))
    shadow.putalpha(em.split()[3].filter(ImageFilter.GaussianBlur(10)).point(lambda p: int(p * 0.6)))

    canvas = base.convert('RGBA')
    pos = ((SIZE - em.size[0]) // 2, (SIZE - em.size[1]) // 2)
    canvas.alpha_composite(shadow, (pos[0], pos[1] + 8))
    canvas.alpha_composite(em, pos)
    canvas = canvas.convert('RGB')

    # 4) віньєтка країв: тло гасне під бічними панелями вікна
    vig = radial_mask(SIZE, outer=1.02).point(lambda p: 60 + int(p * 0.78))
    dark = Image.new('RGB', (SIZE, SIZE), (6, 7, 9))
    canvas = Image.composite(canvas, dark, vig)

    # 5) стеля яскравості
    canvas = canvas.point(lambda p: min(p, CEIL))

    path = OUT + 'tree_bg_' + fac + '.png'
    canvas.save(path)
    lum = canvas.convert('L')
    st = ImageStat.Stat(lum)
    print('%-9s max %3d  mean %5.1f  -> %s' % (fac, lum.getextrema()[1], st.mean[0], os.path.basename(path)))
    return path


paths = [build(fac, f, tint) for fac, (f, tint) in FACTIONS.items()]

# контактний аркуш для очного огляду: показуємо, як тло виглядатиме ПІСЛЯ розтягу рушієм
sheet = Image.new('RGB', (4 * 360, 2 * 290), (24, 24, 28))
for i, p in enumerate(paths):
    im = Image.open(p).resize((350, 279), Image.LANCZOS)  # 1.2545:1 — як у грі
    sheet.paste(im, ((i % 4) * 360 + 5, (i // 4) * 290 + 5))
sheet.save(OUT + 'contact_sheet.png')
print('аркуш:', OUT + 'contact_sheet.png')
