"""Erzeugt ineinanderliegende Hoehenlinien als geschlossene Bezierpfade."""
import math

def ring(cx, cy, r, wellen, phase, punkte=16):
    """Ein geschlossener Ring, leicht verbeult - wie eine Hoehenlinie."""
    pts = []
    for i in range(punkte):
        a = 2 * math.pi * i / punkte
        d = r
        for k, (amp, freq) in enumerate(wellen):
            d += amp * math.sin(freq * a + phase + k * 1.7)
        pts.append((cx + d * math.cos(a), cy + d * math.sin(a) * 0.72))
    return pts

def glatt(pts):
    """Catmull-Rom durch die Punkte, als kubische Beziers ausgegeben."""
    n = len(pts)
    d = f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(n):
        p0 = pts[(i - 1) % n]; p1 = pts[i]; p2 = pts[(i + 1) % n]; p3 = pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d + "Z"

# Zwei Erhebungen, wie auf einer topografischen Karte: eine grosse rechts
# oben, eine kleinere links unten. Die Zahlen sind gewuerfelt und dann
# festgehalten - nicht zufaellig zur Laufzeit, sonst flackert jeder Bau.
gruppen = [
    (760, 240, [(34, 3), (18, 5)], 0.4, 9, 62),
    (240, 690, [(26, 4), (14, 6)], 2.1, 7, 54),
]
for cx, cy, wellen, phase, anzahl, schritt in gruppen:
    for i in range(anzahl):
        r = 70 + i * schritt
        daempf = [(a * (1 + i * 0.16), f) for a, f in wellen]
        print(f'<path d="{glatt(ring(cx, cy, r, daempf, phase + i * 0.22))}"/>')
