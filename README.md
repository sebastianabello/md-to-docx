# md-to-docx

CLI en Node.js que convierte archivos Markdown (`.md`) a documentos Word
(`.docx`) **con diseño profesional**: tipografía cuidada, paleta de colores
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
disponibles, los diagramas se renderizan como PNG; si no, se insertan como
bloque de código con una etiqueta `📊 Diagrama (sintaxis Mermaid)`.

Para habilitar el renderizado de Mermaid a imagen:

```bash
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
├── src/
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
