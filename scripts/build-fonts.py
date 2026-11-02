"""
build-fonts.py — Genera las instancias estáticas de las fuentes del PDF.

Chrome incrusta las fuentes *variables* en el PDF como Type 3 (contornos sin
hinting), que muchos visores muestran con letras recortadas. Con instancias
estáticas (un archivo por grosor/anchura) las incrusta como TrueType normal.

Uso (desde la raíz del proyecto, con las fuentes variables de google/fonts en
<origen>):

    uv run --with fonttools python scripts/build-fonts.py <origen>

Escribe los .ttf en assets/fonts/.
"""

import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

# (archivo de salida, fuente variable de origen, posición en los ejes)
INSTANCES = [
    # Cuerpo: Literata con tamaño óptico de texto.
    ("Literata-400.ttf", "Literata[opsz,wght].ttf", {"opsz": 12, "wght": 400}),
    ("Literata-600.ttf", "Literata[opsz,wght].ttf", {"opsz": 12, "wght": 600}),
    ("Literata-Italic-400.ttf", "Literata-Italic[opsz,wght].ttf", {"opsz": 12, "wght": 400}),
    ("Literata-Italic-600.ttf", "Literata-Italic[opsz,wght].ttf", {"opsz": 12, "wght": 600}),
    # Estructura: Archivo a anchura normal.
    *[(f"Archivo-{w}.ttf", "Archivo[wdth,wght].ttf", {"wdth": 100, "wght": w}) for w in (400, 500, 600, 700, 800)],
    # Tablas: Archivo algo condensada.
    *[(f"ArchivoCompacta-{w}.ttf", "Archivo[wdth,wght].ttf", {"wdth": 92, "wght": w}) for w in (400, 600, 700)],
    # Portada, separadores y pestañas: Archivo expandida.
    *[(f"ArchivoAncha-{w}.ttf", "Archivo[wdth,wght].ttf", {"wdth": 125, "wght": w}) for w in (800, 900)],
    # Código; el 700 evita la negrita simulada (que Chrome incrusta como Type 3).
    *[(f"JetBrainsMono-{w}.ttf", "JetBrainsMono[wght].ttf", {"wght": w}) for w in (400, 700)],
]


def main(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, source, axes in INSTANCES:
        font = TTFont(src / source)
        static = instantiateVariableFont(font, axes)
        static.save(out / name)
        print(f"  {name}  {axes}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Uso: python scripts/build-fonts.py <carpeta-con-fuentes-variables>")
    main(Path(sys.argv[1]), Path(__file__).resolve().parent.parent / "assets" / "fonts")
