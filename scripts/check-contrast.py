#!/usr/bin/env python3
"""
Colour contrast, measured instead of eyeballed.

    python3 scripts/check-contrast.py            # every page, component and layout file
    python3 scripts/check-contrast.py src/pages # one subtree

The app never writes a hex: `tailwind.config.js` maps each utility onto a variable in `src/theme.css`, and
the two themes give that variable two different values. So the only honest way to ask "can this be read?" is
to take the class names off the JSX, resolve them against both themes, blend any `/40` alpha over the
surface the element actually sits on, and run the WCAG 2.1 relative-luminance formula.

Small text needs 4.5:1, and anything at 18.66px+ bold or 24px+ needs 3:1 — this reports against 4.5 because
almost everything in the admin is `text-xs`/`text-sm`, and says which floor it used.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FE = os.path.join(ROOT, 'frontend')
THEME = open(os.path.join(FE, 'src/theme.css')).read()

# ── tokens ───────────────────────────────────────────────────────────────────────────────────
def theme_vars(block):
    out = {}
    for name, chans in re.findall(r'--([a-z0-9-]+):\s*(\d+ \d+ \d+)', block):
        out[name] = tuple(int(x) for x in chans.split())
    return out

THEMES = {}
for sel, body in re.findall(r'html\.(dark|light)\s*\{([^}]*)\}', THEME, re.S):
    # theme.css repeats `html.light` for rules that are not colour ramps — merge, never overwrite.
    THEMES.setdefault(sel, {}).update(theme_vars(body))
assert len(THEMES.get('dark', {})) > 40 and len(THEMES.get('light', {})) > 40, 'theme.css was not parsed as expected'

# Tailwind's default palette, only the shades this app actually writes on top of tinted backgrounds.
FALLBACK = {
    'white': (255, 255, 255),
    'slate-100': (241, 245, 249), 'slate-200': (226, 232, 240), 'slate-300': (203, 213, 225),
    'slate-400': (148, 163, 184), 'slate-500': (100, 115, 139), 'slate-600': (71, 85, 105),
    'red-200': (254, 202, 202), 'red-300': (252, 165, 165), 'red-400': (248, 113, 113),
    'amber-200': (253, 230, 138), 'amber-300': (252, 211, 77), 'amber-400': (251, 191, 36),
    'emerald-200': (167, 243, 208), 'emerald-300': (110, 231, 183), 'emerald-400': (52, 211, 153),
    'sky-200': (186, 230, 253), 'sky-300': (125, 211, 252), 'sky-400': (56, 189, 248),
    'violet-300': (196, 181, 253), 'rose-300': (253, 164, 175),
}

def rgb(token, theme):
    """`slate-400` / `ink-900` / `bad` → a tuple, theme first, Tailwind default second."""
    if token in THEMES[theme]:
        return THEMES[theme][token]
    return FALLBACK.get(token)

def lum(c):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = c
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def over(fg, alpha, bg):
    return tuple(round(fg[i] * alpha + bg[i] * (1 - alpha)) for i in range(3))

# ── the component classes, read out of index.css ───────────────────────────────────────────────
INDEX = open(os.path.join(FE, 'src/index.css')).read()
COMPONENTS = {}
for name, decl in re.findall(r'\.([a-z-]+)\s*\{\s*@apply([^;}]+);', INDEX):
    cls = 'class="' + ' '.join(decl.split()) + '"'
    COMPONENTS[name] = cls
# What a bare element sits on. Both themes use the same variable names — that is the whole point of the
# ramp in theme.css — so `ink-950` is the page in dark and the paper in light.
SURFACE = {'dark': 'ink-950', 'light': 'ink-950'}

def surface_for(text, theme, own):
    """The background an element really has: its own `bg-…`, else the panel, else the page."""
    if own:
        return own
    return 'ink-900' if 'panel' in text else SURFACE[theme]

PAIR = re.compile(r'\b(text|bg|border)-(ink|brand|slate|red|amber|emerald|sky|good|bad|warn|paper|violet|rose|white)(-[0-9]{2,3})?(?:/([0-9]{1,3}))?\b')

def check(files):
    rows = []
    check.measured = 0
    for path in files:
        src = open(path).read()
        for ln, line in enumerate(src.split('\n'), 1):
            # Every quoted fragment on the line is a candidate class string: JSX builds many of them by
            # concatenation (`'…' + (x ? 'bg-red-500/10 text-red-100' : '…')`), and a scan that only looked
            # at `className="…"` would quietly skip the tinted ones — which are the ones that fail.
            for m in re.finditer(r'''['"]([^'"]{4,})['"]''', line):
                frag = m.group(1)
                if 'text-' not in frag:
                    continue
                for other in re.finditer(r'''['"]([^'"]{4,})['"]''', line):
                    if 'bg-' in other.group(1):
                        frag = frag + ' ' + other.group(1)
                        break
                for cls, body in COMPONENTS.items():
                    if re.search(r'(^|\s)' + re.escape(cls) + r'(\s|$)', frag):
                        frag += ' ' + body
                texts = [t for t in PAIR.finditer(frag) if t.group(1) == 'text']
                bgs = [t for t in PAIR.finditer(frag) if t.group(1) == 'bg']
                if not texts:
                    continue
                for theme in ('dark', 'light'):
                    surf = None
                    surf = rgb('ink-900' if ('panel' in frag or 'rounded' in frag) else SURFACE[theme], theme)
                    if bgs:
                        # A tinted background (`bg-bad/10`) is the token blended over whatever is behind it.
                        base = rgb(bgs[0].group(2) + (bgs[0].group(3) or ''), theme) or rgb(bgs[0].group(2), theme)
                        if base:
                            alpha = int(bgs[0].group(4) or 100) / 100
                            surf = over(base, alpha, surf) if alpha < 1 else base
                    if not surf:
                        continue
                    for t in texts:
                        tok = (t.group(2) + (t.group(3) or ''))
                        fg = rgb(tok, theme)
                        if not fg:
                            continue
                        alpha = int(t.group(4) or 100) / 100
                        fg = over(fg, alpha, surf) if alpha < 1 else fg
                        check.measured += 1
                        r = ratio(fg, surf)
                        big = any(k in frag for k in ('text-xl', 'text-2xl', 'text-3xl', 'text-4xl'))
                        floor = 3.0 if big else 4.5
                        if r < floor:
                            rows.append((round(r, 2), f'{os.path.relpath(path, FE)}:{ln}', theme, tok, f'ratio {r:.2f} < {floor}', frag[:70]))
    return rows

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else 'src'
    base = os.path.join(FE, target) if not os.path.isabs(target) else target
    files = []
    for root, _, names in os.walk(base):
        if 'node_modules' in root:
            continue
        files += [os.path.join(root, n) for n in names if n.endswith(('.jsx', '.js'))]
    rows = check(sorted(files))
    rows.sort()
    print(f'{len(files)} files scanned · {check.measured} combinations measured · {len(rows)} under the WCAG floor')
    for r, where, theme, tok, msg, frag in rows[:40]:
        print(f'  {r:>5}  {theme:<5} {tok:<14} {where:<58} {msg}')
    if len(rows) > 40:
        print(f'  … {len(rows) - 40} more')

if __name__ == '__main__':
    main()
