"""
Ojo de números -> pupila rosa con corazones -> "te amo princesa"

Requisitos:  pip install numpy matplotlib pillow
Uso:         python ojo_te_amo_princesa.py          (abre la animación)
             python ojo_te_amo_princesa.py --gif    (además guarda te_amo_princesa.gif)
"""
import sys
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from matplotlib import font_manager
from PIL import Image, ImageDraw, ImageFont

TEXTO = "te amo princesa"
N_PUNTOS = 2400          # cantidad de números que forman el ojo
RADIO_PUPILA = 0.30
RADIO_IRIS = 0.42
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- el ojo
# Forma de almendra: |y| <= 0.5 * (1 - x^2)
ojo = []
while len(ojo) < N_PUNTOS:
    x, y = rng.uniform(-1, 1), rng.uniform(-0.5, 0.5)
    if abs(y) <= 0.5 * (1 - x ** 2):
        ojo.append((x, y))
ojo = np.array(ojo)
radio = np.hypot(ojo[:, 0], ojo[:, 1])
es_pupila = radio < RADIO_PUPILA
es_iris = (radio >= RADIO_PUPILA) & (radio < RADIO_IRIS)
digitos = rng.integers(0, 10, N_PUNTOS)

# Colores iniciales: blanco azulado (esclerótica), violeta (iris)
color_ojo = np.tile([0.75, 0.86, 1.0], (N_PUNTOS, 1))
color_ojo[es_iris] = [0.80, 0.45, 0.95]
color_ojo[es_pupila] = [0.95, 0.95, 1.0]
ROSA_PUPILA = np.array([1.0, 0.35, 0.65])

# ------------------------------------------------- puntos que forman el texto
fuente_path = font_manager.findfont(font_manager.FontProperties(family="DejaVu Sans", weight="normal"))
fuente = ImageFont.truetype(fuente_path, 170)
W, H = 1800, 300
img = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(img)
bbox = d.textbbox((0, 0), TEXTO, font=fuente)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((W - tw) / 2 - bbox[0], (H - th) / 2 - bbox[1]), TEXTO, font=fuente, fill=255)
ys, xs = np.nonzero(np.array(img) > 128)
idx = rng.choice(len(xs), N_PUNTOS, replace=False)
destino = np.column_stack(((xs[idx] - W / 2) / W * 3.8, -(ys[idx] - H / 2) / W * 3.8))

# Degradado rosa del texto final
t = (destino[:, 0] + 1.9) / 3.8
color_texto = np.column_stack((np.ones(N_PUNTOS), 0.45 + 0.35 * t, 0.70 + 0.2 * t))

# ------------------------------------------------------------- corazón
tt = np.linspace(0, 2 * np.pi, 120)
hx = 16 * np.sin(tt) ** 3
hy = 13 * np.cos(tt) - 5 * np.cos(2 * tt) - 2 * np.cos(3 * tt) - np.cos(4 * tt)
corazon = np.column_stack((hx, hy)) / 17.0

# ------------------------------------------------------------- figura
fig, ax = plt.subplots(figsize=(12, 6.5))
fig.patch.set_facecolor("#0b0b14")
ax.set_facecolor("#0b0b14")
ax.set_xlim(-2, 2)
ax.set_ylim(-1.1, 1.1)
ax.set_aspect("equal")
ax.axis("off")

grupos = []
for dgt in range(10):
    ids = np.where(digitos == dgt)[0]
    sc = ax.scatter(ojo[ids, 0], ojo[ids, 1], marker=f"${dgt}$", s=34, linewidths=0.2)
    grupos.append((ids, sc))

ids_h = np.where(es_pupila)[0]
sc_h = ax.scatter(ojo[ids_h, 0], ojo[ids_h, 1], marker=corazon, s=45, linewidths=0)

retraso_aparecer = rng.uniform(0, 30, N_PUNTOS)
retraso_mover = rng.uniform(0, 30, N_PUNTOS)


def suave(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def update(f):
    aparece = np.clip((f - retraso_aparecer) / 15, 0, 1)
    p = suave((f - 50) / 50)                       # pupila se vuelve rosa
    m = suave((f - 170 - retraso_mover) / 90)      # forman el texto

    pos = ojo * (1 - m[:, None]) + destino * m[:, None]
    col = color_ojo.copy()
    col[es_pupila] = color_ojo[es_pupila] * (1 - p) + ROSA_PUPILA * p
    col = col * (1 - m[:, None]) + color_texto * m[:, None]

    alfa = aparece.copy()
    alfa[es_pupila] *= (1 - p)          # los números de la pupila se vuelven corazones
    rgba = np.column_stack((col, alfa))

    for ids, sc in grupos:
        sc.set_offsets(pos[ids])
        sc.set_facecolor(rgba[ids])
        sc.set_edgecolor(rgba[ids])

    latido = 1 + 0.15 * np.sin(f / 4) * (1 - m[ids_h].mean())
    sc_h.set_offsets(pos[ids_h])
    sc_h.set_sizes(np.full(len(ids_h), 45 * latido))
    rgba_h = np.column_stack((col[ids_h], aparece[ids_h] * p))
    sc_h.set_facecolor(rgba_h)
    return [sc for _, sc in grupos] + [sc_h]


TOTAL = 350
anim = FuncAnimation(fig, update, frames=TOTAL, interval=33, blit=False, repeat=False)

if "--gif" in sys.argv:
    anim.save("te_amo_princesa.gif", writer="pillow", fps=30, savefig_kwargs={"facecolor": "#0b0b14"})
    print("Guardado: te_amo_princesa.gif")

plt.show()