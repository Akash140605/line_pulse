#!/usr/bin/env python3
"""
26-11-2026: app.legacy.css for browsers older than Chrome / Edge 111 (an old Windows 10 Edge drew the app unstyled):
Tailwind v4 output uses cascade layers, oklch() colours, range media queries, dvh and the translate / scale / rotate
properties. This flattens the layers (same order), turns oklch into rgb, range queries into min / max-width, adds vh
before dvh and writes the transform properties as transform. index.html loads it only when the browser lacks layers
or oklch.  usage: legacy_css.py app.css app.legacy.css
"""
import math
import re
import sys


def oklch_to_rgb(L, C, H):
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def gam(x):
        x = max(0.0, min(1.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    return [round(gam(v) * 255) for v in (r, g, bb)]


def num(t, pct_scale=1.0):
    t = t.strip()
    if t == 'none':
        return 0.0
    if t.endswith('%'):
        return float(t[:-1]) / 100 * pct_scale
    return float(t)


def conv_oklch(m):
    body = m.group(1)
    if 'var(' in body or 'calc(' in body:
        return m.group(0)
    parts = body.replace('/', ' / ').split()
    alpha = None
    if '/' in parts:
        i = parts.index('/')
        alpha = parts[i + 1]
        parts = parts[:i]
    if len(parts) != 3:
        return m.group(0)
    try:
        L = num(parts[0], 1.0)
        C = num(parts[1], 0.4)
        H = num(parts[2].replace('deg', ''))
    except ValueError:
        return m.group(0)
    r, g, b = oklch_to_rgb(L, C, H)
    if alpha is None:
        return f'rgb({r}, {g}, {b})'
    try:
        a = num(alpha)
    except ValueError:
        return f'rgb({r}, {g}, {b})'
    return f'rgba({r}, {g}, {b}, {round(a, 3)})'


def flatten_layers(s):
    s = re.sub(r'@layer\s+[\w\s,.-]+;', '', s)
    out = []
    i = 0
    while True:
        m = re.compile(r'@layer\s+[\w.-]+\s*\{').search(s, i)
        if not m:
            out.append(s[i:])
            break
        out.append(s[i:m.start()])
        depth, j = 1, m.end()
        while depth and j < len(s):
            c = s[j]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
            j += 1
        inner = s[m.end():j - 1]
        out.append(flatten_layers(inner))
        i = j
    return ''.join(out)


def range_media(s):
    def one(m):
        feat, op, val = m.group(1), m.group(2), m.group(3).strip()
        if op == '>=':
            return f'(min-{feat}: {val})'
        if op == '>':
            return f'(min-{feat}: calc({val} + 0.02px))'
        if op == '<=':
            return f'(max-{feat}: {val})'
        return f'(max-{feat}: calc({val} - 0.02px))'
    return re.sub(r'\((width|height)\s*(>=|<=|>|<)\s*([^)]+)\)', one, s)


def props(s):
    s = re.sub(r'(?<![-\w])translate:\s*([^;{}]+);', lambda m: 'transform: translate(' + ', '.join(m.group(1).split()) + ');', s)
    s = re.sub(r'(?<![-\w])scale:\s*([^;{}]+);', lambda m: 'transform: scale(' + ', '.join(m.group(1).split()) + ');', s)
    s = re.sub(r'(?<![-\w])rotate:\s*([^;{}]+);', lambda m: 'transform: rotate(' + m.group(1).strip() + ');', s)
    s = re.sub(r'([\w-]+):\s*([^;{}]*\d+dvh[^;{}]*);', lambda m: f"{m.group(1)}: {re.sub(r'(\\d+)dvh', r'\\1vh', m.group(2))}; {m.group(1)}: {m.group(2)};", s)
    return s


def main(src, dst):
    s = open(src, encoding='utf-8').read()
    s = flatten_layers(s)
    s = re.sub(r'oklch\(([^()]*)\)', conv_oklch, s)
    s = range_media(s)
    s = props(s)
    open(dst, 'w', encoding='utf-8').write(s)
    left = {k: len(re.findall(p, s)) for k, p in [('@layer', r'@layer'), ('oklch', r'oklch\('), ('range', r'\((?:width|height)\s*[<>]')]}
    print('legacy css written', dst, len(s), 'bytes · left:', left)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
