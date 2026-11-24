"""Render the static card art and web map from Census road geometry.

Usage: python3 scripts/build-cards.py  (needs rsvg-convert and Noto Sans)
Writes public/map.svg and public/cards/{yes,no,unknown}.png (1080x1350).
The Worker draws the live delay, direction and time on top of the PNGs.
"""

import json
import math
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
roads = json.loads((ROOT / "data" / "tulsa-roads.json").read_text())
west, south, east, north = roads["bbox"]
k = math.cos(math.radians((south + north) / 2))

DOWNTOWN = (-95.983615, 36.144100)
BROKEN_ARROW = (-95.742998, 36.038320)


def projector(x0, y0, w, h):
    span_x = (east - west) * k
    span_y = north - south
    scale = min(w / span_x, h / span_y)
    ox = x0 + (w - span_x * scale) / 2
    oy = y0 + (h - span_y * scale) / 2

    def project(lon, lat):
        return (ox + (lon - west) * k * scale, oy + (north - lat) * scale)

    return project


def path(line, project):
    pts = [project(x, y) for x, y in line]
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def map_group(x0, y0, w, h, ba_color, road_color, label_color, font_size):
    project = projector(x0, y0, w, h)
    clip = f"clip{int(x0)}{int(y0)}"
    parts = [f'<clipPath id="{clip}"><rect x="{x0 - 20}" y="{y0 - 20}" width="{w + 40}" height="{h + 40}" rx="28"/></clipPath><g clip-path="url(#{clip})">']
    for line in roads["highway"]:
        parts.append(f'<path d="{path(line, project)}" stroke="{road_color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    for line in roads["ba"]:
        parts.append(f'<path d="{path(line, project)}" stroke="{ba_color}" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    parts.append("</g>")
    for (lon, lat), label, anchor, dx, dy in [
        (DOWNTOWN, "Downtown Tulsa", "start", 22, -18),
        (BROKEN_ARROW, "Broken Arrow", "end", -22, 44),
    ]:
        x, y = project(lon, lat)
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="13" fill="{label_color}" stroke="#ffffff" stroke-width="5"/>')
        parts.append(f'<text x="{x + dx:.1f}" y="{y + dy:.1f}" font-size="{font_size}" font-weight="700" fill="{label_color}" text-anchor="{anchor}" paint-order="stroke" stroke="#ffffff" stroke-width="8">{label}</text>')
    return "\n".join(parts)


THEMES = {
    "yes": {"bg": "#ffffff", "fg": "#111111", "word": "Yes", "ba": "#16a34a", "panel": "#f3f4f6"},
    "no": {"bg": "#b91c1c", "fg": "#ffffff", "word": "No", "ba": "#b91c1c", "panel": "#fef2f2"},
    "unknown": {"bg": "#4b5563", "fg": "#ffffff", "word": "?", "ba": "#6b7280", "panel": "#f3f4f6"},
}


def card(theme):
    t = THEMES[theme]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" font-family="Noto Sans">
<rect width="1080" height="1350" fill="{t['bg']}"/>
<text x="540" y="120" font-size="52" font-weight="500" fill="{t['fg']}" text-anchor="middle">Should I take the BA?</text>
<text x="540" y="380" font-size="270" font-weight="900" fill="{t['fg']}" text-anchor="middle">{t['word']}</text>
<rect x="60" y="440" width="960" height="620" rx="28" fill="{t['panel']}"/>
{map_group(80, 460, 920, 580, t['ba'], '#c7cbd1', '#111111', 34)}
<text x="540" y="1310" font-size="34" font-weight="500" fill="{t['fg']}" text-anchor="middle" opacity="0.85">shoulditaketheba.com · map data: US Census TIGER/Line</text>
</svg>"""


def web_map():
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 620" role="img" aria-label="Map of the Broken Arrow Expressway from downtown Tulsa to Broken Arrow" font-family="system-ui, sans-serif">
<rect width="960" height="620" rx="20" fill="#f3f4f6"/>
{map_group(20, 20, 920, 580, '#2563eb', '#c7cbd1', '#111111', 28)}
</svg>"""


def main():
    public = ROOT / "public"
    cards = public / "cards"
    cards.mkdir(parents=True, exist_ok=True)
    (public / "map.svg").write_text(web_map())
    for theme in THEMES:
        svg = cards / f"{theme}.svg"
        svg.write_text(card(theme))
        subprocess.run(["rsvg-convert", "-w", "1080", "-h", "1350", "-o", str(cards / f"{theme}.png"), str(svg)], check=True)
        svg.unlink()
    print("wrote", sorted(p.name for p in cards.iterdir()))


if __name__ == "__main__":
    main()
