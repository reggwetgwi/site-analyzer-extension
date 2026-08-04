"""
Генератор иконок для расширения Site Analyzer.

Рисует иконку (синий фон со скруглением, белая линия тренда с точками и лупа)
и сохраняет PNG 16x16, 48x48, 128x128. Без внешних зависимостей — только
стандартная библиотека (struct, zlib). Рендер идёт с супер-сэмплингом для
сглаживания краёв.
"""

import math
import os
import struct
import zlib

# Цвета
BG = (37, 99, 235)      # синий фон
FG = (255, 255, 255)    # белые элементы

# Иконка описывается в координатном пространстве 128x128
CANVAS = 128
SS = 4  # коэффициент супер-сэмплинга


def _dist_point_segment(px, py, ax, ay, bx, by):
    """Расстояние от точки до отрезка AB."""
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def _rounded_rect_contains(x, y, w, h, r):
    """Внутри ли точка (x, y) прямоугольника w×h со скруглением r."""
    if x < 0 or y < 0 or x > w or y > h:
        return False
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return math.hypot(x - cx, y - cy) <= r


# Геометрия иконки (в пространстве 128)
TREND = [(20, 90), (40, 70), (60, 80), (80, 50), (108, 30)]
DOTS = TREND
LINE_W = 6
DOT_R = 5
LENS_C = (90, 95)
LENS_R = 18
LENS_W = 5
HANDLE = ((103, 108), (118, 123))


def _color_at(x, y):
    """Возвращает (r, g, b) для точки в пространстве 128, либо None (прозрачно)."""
    # Фон со скруглением
    if not _rounded_rect_contains(x, y, CANVAS, CANVAS, 24):
        return None

    color = BG

    # Линия тренда
    for i in range(len(TREND) - 1):
        ax, ay = TREND[i]
        bx, by = TREND[i + 1]
        if _dist_point_segment(x, y, ax, ay, bx, by) <= LINE_W / 2:
            color = FG

    # Точки
    for dx, dy in DOTS:
        if math.hypot(x - dx, y - dy) <= DOT_R:
            color = FG

    # Лупа (кольцо)
    d_lens = math.hypot(x - LENS_C[0], y - LENS_C[1])
    if abs(d_lens - LENS_R) <= LENS_W / 2:
        color = FG

    # Ручка лупы
    (hx1, hy1), (hx2, hy2) = HANDLE
    if _dist_point_segment(x, y, hx1, hy1, hx2, hy2) <= LENS_W / 2:
        color = FG

    return color


def render_rgba(size):
    """Рендерит иконку размера size×size c альфа-каналом (супер-сэмплинг)."""
    scale = CANVAS / size
    pixels = bytearray()

    for py in range(size):
        for px in range(size):
            r_sum = g_sum = b_sum = a_sum = 0
            for sy in range(SS):
                for sx in range(SS):
                    # Центр субпикселя в пространстве 128
                    fx = (px + (sx + 0.5) / SS) * scale
                    fy = (py + (sy + 0.5) / SS) * scale
                    c = _color_at(fx, fy)
                    if c is not None:
                        r_sum += c[0]
                        g_sum += c[1]
                        b_sum += c[2]
                        a_sum += 255
            n = SS * SS
            a = a_sum // n
            if a == 0:
                pixels.extend((0, 0, 0, 0))
            else:
                # Усредняем цвет только по непрозрачным субпикселям
                opaque = a_sum // 255
                pixels.extend((
                    r_sum // opaque,
                    g_sum // opaque,
                    b_sum // opaque,
                    a,
                ))
    return bytes(pixels)


def save_png(path, size, rgba):
    """Сохраняет RGBA-данные в PNG (truecolor + alpha)."""
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA

    # Добавляем фильтр-байт (0) в начало каждой строки
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', idat)
        + chunk(b'IEND', b'')
    )
    with open(path, 'wb') as f:
        f.write(png)


def main():
    icons_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    print("Генерация иконок для расширения Site Analyzer...")
    for size in (16, 48, 128):
        out = os.path.join(icons_dir, f'icon{size}.png')
        print(f"  Создание icon{size}.png...")
        save_png(out, size, render_rgba(size))
        print(f"  [OK] icon{size}.png создана")

    print("\nГотово! Иконки созданы в папке icons/")


if __name__ == '__main__':
    main()
