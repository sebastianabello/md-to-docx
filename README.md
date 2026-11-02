# md-to-docx

CLI en Node.js que convierte archivos Markdown (`.md`) a documentos Word
(`.docx`) o a PDF **con diseño profesional**: tipografía cuidada, paleta de colores
coherente, cajas de advertencia/tip/concepto, tablas formateadas, bloques de
código monoespaciados y diagramas **Mermaid** renderizados como imágenes.

A diferencia de pandoc u otros conversores, el resultado no es un documento
crudo: cada elemento se renderiza con un sistema de diseño definido a nivel de
XML mediante la librería [`docx`](https://docx.js.org).

## Instalación

```bash
npm install
```

Esto instala las dependencias principales (`docx`, `marked`). El renderizado de
Mermaid es **opcional**: si `@mermaid-js/mermaid-cli` y un Chrome/Chromium están
disponibles, los diagramas se renderizan como PNG (a 3x de resolución para que se
vean nítidos al ampliarlos) **y además se incluye su código fuente debajo**, por
si la imagen resulta pequeña. Si no hay Chrome, se insertan solo como bloque de
código con una etiqueta `📊 Diagrama (sintaxis Mermaid)`.

Para habilitar el renderizado de Mermaid a imagen:

```bash
sudo apt install -y chromium fonts-liberation ca-certificates
npm install -g @mermaid-js/mermaid-cli   # provee el binario `mmdc`
```

## Uso

```bash
node convert.js <input.md> [más.md ...] <output.docx> [opciones]
node convert.js <input.md> [más.md ...] -o <output.docx> [opciones]
```

Ejemplos:

```bash
# Un archivo, con encabezado de página personalizado
node convert.js test.md test.docx --title "Guía de Estudio DevOps"

# Varios archivos combinados en un único .docx, con portada y subtítulo
node convert.js cap1.md cap2.md cap3.md -o libro.docx \
  --doc-title "Manual DevOps" --subtitle "Edición 2026" --title "Curso DevOps"
```

Al combinar varios archivos se insertan saltos de página entre ellos y se
genera una única portada e índice; la numeración de listas es consistente en
todo el documento.

### Opciones

| Opción            | Descripción                                                      |
| ----------------- | --------------------------------------------------------------- |
| `-t, --title`     | Texto del **encabezado de cada página** (default: "Guía de Estudio DevOps") |
| `-d, --doc-title` | **Título del documento en la portada** (primera hoja)           |
| `-s, --subtitle`  | Subtítulo de la portada (junto a `--doc-title`)                  |
| `-o, --output`    | Archivo `.docx` de salida (alternativa al último posicional)     |
| `-h, --help`      | Muestra la ayuda                                                 |

> **Portada:** si pasas `--doc-title`, se usa como portada. Si no, se detecta
> automáticamente cuando el primer archivo empieza con un `# Título` seguido de
> un `## Subtítulo`.

## Salida PDF

Si el archivo de salida termina en `.pdf`, se genera un PDF maquetado con
Chrome headless + [Paged.js](https://pagedjs.org) (en vez de pasar por Word).
Además de archivos sueltos, acepta **una carpeta de curso**: cada subcarpeta es
un módulo, y su `index.md` aporta el título de la portada, los nombres de los
módulos y la descripción de cada artículo.

```bash
node convert.js ~/Documents/proyectos/brain/wiki/psoe -o psoe.pdf
node convert.js apunte.md apunte.pdf --html debug.html   # guarda el HTML intermedio
```

Lo que añade el PDF:

- **Pestañas de módulo** en el borde derecho, cada una a su altura (como las
  solapas de una carpeta de anillas); la portada muestra todas.
- **Índice y separadores de módulo** con números de página reales.
- **Wikilinks de Obsidian** (`[[ruta.md|Etiqueta]]`) convertidos en enlaces
  internos con su página («p. 34»); **notas `[^n]`** enlazadas a «Fuentes»;
  el **frontmatter** YAML se usa como metadatos y no se imprime.
- Secciones con tratamiento propio: «Claves para el examen» (marcador
  amarillo), «Verificación con la documentación oficial», «Ver también» y
  «Fuentes»; apartes para discrepancias y erratas de la fuente.
- Tipografía incrustada (Literata, Archivo y JetBrains Mono, licencia OFL):
  el PDF se ve igual en cualquier equipo.

### Fuentes del PDF

Las fuentes viven en `assets/fonts/` como **instancias estáticas** (un `.ttf`
por grosor y anchura). No se usan las variables directamente porque Chrome
las incrusta en el PDF como *Type 3*, y muchos visores muestran esas letras
recortadas. Por la misma razón el CSS usa `font-synthesis: none`: una negrita
o cursiva *simulada* también acaba en Type 3, así que cada grosor que use el
CSS debe existir como archivo.

Para regenerarlas (p. ej. para añadir un grosor), descarga las fuentes
variables de [google/fonts](https://github.com/google/fonts) (`ofl/literata`,
`ofl/archivo`, `ofl/jetbrainsmono`) a una carpeta y ejecuta:

```bash
uv run --with fonttools python scripts/build-fonts.py <carpeta>
```

Comprobación rápida: `pdffonts salida.pdf` no debería listar fuentes
`Type 3` salvo `NotoColorEmoji` (los emoji en color siempre van así).

El estilo vive en `src/pdf/theme.css`; la conversión, en `src/pdf/build.js`
(Markdown → HTML) y `src/pdf/print.js` (HTML → PDF). Requiere Chrome o
Chromium instalado (o `PUPPETEER_EXECUTABLE_PATH`).

## Elementos soportados

- **Headings** H1–H3 (estilos built-in sobrescritos, con índice navegable).
- **Párrafos** con **negrita**, *itálica*, `código inline` y enlaces.
- **Listas** con viñetas y numeradas (anidadas; cada lista numerada reinicia en 1).
- **Tablas** GFM (anchos en DXA, compatibles con Google Docs).
- **Bloques de código** con tema terminal oscuro y comentarios resaltados.
- **Blockquotes** y **cajas especiales** (💡 buena práctica, ⚠️ advertencia, 🔎 concepto).
- **Diagramas Mermaid** (imagen + fallback a código).
- **Imágenes** (`png`, `jpg`, `gif`), **reglas horizontales**, **portada** y **`[TOC]`**.

## Sistema de diseño

- **Cuerpo:** Inter, 11pt, color `#2D3748`.
- **Títulos:** Plus Jakarta Sans (H1 `#1F4E79`, H2 `#2E75B6`, H3 `#4A5568`).
- **Código en bloque:** estilo terminal — bloque oscuro `#0D1117` con texto gris
  claro `#E6EDF3` en Consolas, comentarios en verde `#6A9955` y corrector
  ortográfico desactivado (sin subrayados rojos). Bloque limpio, sin bordes ni
  etiqueta de lenguaje.
- **Código inline:** Consolas sobre fondo claro `#F8FAFC`, texto `#C7254E`.
- **Página:** US Letter, márgenes de 1 pulgada, header/footer en gris `#718096`.

> **Nota sobre fuentes:** Inter y Plus Jakarta Sans deben estar instaladas en
> el equipo que **abre** el `.docx` para verse correctamente; de lo contrario,
> Word/Google Docs sustituirán por una fuente equivalente. El `.docx` referencia
> las fuentes por nombre (no las incrusta).

## Estructura del proyecto

```
md-to-docx/
├── convert.js          ← CLI principal
├── assets/fonts/      ← Fuentes estáticas del PDF (OFL)
├── scripts/
│   └── build-fonts.py  ← Genera assets/fonts desde las fuentes variables
├── src/
│   ├── pdf/
│   │   ├── build.js    ← Markdown/carpeta de curso → HTML paginable
│   │   ├── print.js    ← HTML → PDF (Chrome + Paged.js)
│   │   └── theme.css   ← Diseño del PDF
│   ├── styles.js       ← Constantes de diseño + estilos del documento
│   ├── numbering.js    ← Referencias de numeración únicas por lista
│   ├── mermaid.js      ← Renderizado Mermaid con fallback
│   ├── parser.js       ← marked.lexer() + helpers (portada, TOC, cajas)
│   └── renderer.js     ← Tokens → elementos docx
├── test.md             ← Documento de ejemplo
└── package.json
```

## Validación

Si existe `scripts/office/validate.py` (validador de docx-js), `convert.js` lo
ejecuta automáticamente sobre el archivo generado y muestra el resultado.

## Licencia

MIT
