#!/usr/bin/env python3
"""Builds the One bar index.html.

New code lives in ob.css, body.html and ob.js. Pieces that carry over unchanged from page v0.4
(icon sprite, preview bridge, QR encoder, utilities, spaces + passport links, search, parsing,
pictures, vCard, the album-art player) are cut from the v0.4 index.html by their section markers.
Usage: assemble.py <v0.4 index.html> <out index.html>"""
import sys

old = open(sys.argv[1], encoding='utf-8').read()


def cut(start, end, inclusive_end=False):
    a = old.index(start)
    b = old.index(end, a + len(start))
    return old[a:b + (len(end) if inclusive_end else 0)]


sprite = cut('<svg width="0" height="0" style="position:absolute" aria-hidden="true">', '</svg>', True)
mock = cut('<script>\n/* Preview bridge', '</script>', True)
mock = mock.replace("copy: t => { try { navigator.clipboard.writeText(t); } catch (e) {} return true; },", "copy: t => { try { navigator.clipboard.writeText(t).catch(() => {}); } catch (e) {} return true; },")
assert 'writeText(t).catch' in mock
qr = cut('<script>\n/* Small QR encoder', '</script>', True)
util = cut('  /* ---------- utilities ---------- */', '  /* ---------- bridge ---------- */')
spaces = cut('  /* ---------- spaces ---------- */', '  /* ---------- model ---------- */')
# the copied block has its own uid(); keep it
search = cut('  /* ---------- search helpers ---------- */', '  /* ---------- small renderers ---------- */')
parse = cut('  function parseDur(s) {', "  // Apps and people")
pics = cut('  const PIC = { db: null, url: {} };', '  const bannerW')
vcard = cut('  function vcard(p) {', "    return L.join('\\r\\n');\n  }", True)
player = cut('  const mmss = ms =>', '  /* ---------- pages ---------- */')
# One bar opens and closes the player its own way.
a = player.index('  // The player grows up out of the mini bar')
b = player.index('  function renderPlayer() {')
player = player[:a] + player[b:]
pcss = cut('.pl-grab{', '.pl-open img{', False)
pcss_end = old.index('\n', old.index('.pl-open img{'))
pcss = old[old.index('.pl-grab{'):pcss_end + 1]
pcss = pcss.replace('.player{touch-action:none}\n', '')

js = open('ob.js', encoding='utf-8').read()
for k, v in [('UTIL', util), ('SPACES', spaces), ('SEARCH', search), ('PARSE', parse), ('PICS', pics), ('VCARD', vcard), ('PLAYER', player)]:
    tag = '/*@@%s@@*/' % k
    assert js.count(tag) == 1, tag
    js = js.replace(tag, v.rstrip('\n'))

css = open('ob.css', encoding='utf-8').read() + pcss
body = open('body.html', encoding='utf-8').read()

html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">
<title>Switchboard</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
{css}</style>
</head>
<body>
{sprite}
{body}
{mock}
{qr}
<script>
{js}</script>
</body>
</html>
'''
open(sys.argv[2], 'w', encoding='utf-8').write(html)
print(len(html), 'bytes,', html.count('\n'), 'lines')
