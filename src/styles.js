"use strict";

/**
 * styles.js — Sistema de diseño centralizado.
 *
 * Todas las constantes visuales del documento (colores, fuentes, tamaños,
 * spacing y geometría de página) viven aquí para mantener un único punto
 * de verdad. Los tamaños de fuente están en half-points (docx-js), las
 * medidas de página/indent en DXA (1/20 de punto = twips).
 */

// ---------------------------------------------------------------------------
// Colores (hex sin '#', como exige docx-js)
// ---------------------------------------------------------------------------
const COLORS = {
  TEXT_MAIN: "2D3748", // gris carbón — cuerpo del texto (nunca negro puro)
  PRIMARY: "1F4E79", // azul oscuro tecnológico — H1
  ACCENT: "2E75B6", // azul medio — H2, acentos, líneas
  LIGHT: "D9E8F5", // azul muy claro — cabeceras de tabla
  CODE_BG: "F8FAFC", // gris slate ultra claro — inline code (sobre texto claro)
  CODE_CARD_BG: "0D1117", // negro/carbón — fondo de la tarjeta de código (tema terminal)
  CODE_TEXT: "E6EDF3", // gris muy claro — texto de código sobre fondo oscuro
  CODE_COMMENT: "6A9955", // verde — comentarios dentro del código (estilo terminal)
  BORDER_SOFT: "E2E8F0", // gris suave — bordes de tabla / blockquote
  MUTED: "718096", // gris medio — header/footer, etiquetas de lenguaje
  INLINE_CODE: "C7254E", // rojo/magenta — texto de inline code
  H3: "4A5568", // gris oscuro corporativo — H3
  WHITE: "FFFFFF",
};

// ---------------------------------------------------------------------------
// Cajas especiales (blockquotes con marcador) y blockquote normal
// ---------------------------------------------------------------------------
const BOXES = {
  tip: { fill: "F0FDF4", border: "16A34A", label: "16A34A" }, // verde menta
  warning: { fill: "FFF7ED", border: "EA580C", label: "EA580C" }, // naranja
  concept: { fill: "F0FDFA", border: "0D9488", label: "0D9488" }, // turquesa
  quote: { fill: "F0F7FF", border: "2E75B6" }, // blockquote normal
};

// ---------------------------------------------------------------------------
// Fuentes
// ---------------------------------------------------------------------------
const FONTS = {
  BODY: "Inter", // cuerpo de texto
  HEAD: "Plus Jakarta Sans", // títulos / labels
  MONO: "Consolas", // código
};

// ---------------------------------------------------------------------------
// Tamaños de fuente (half-points: 22 == 11pt)
// ---------------------------------------------------------------------------
const SIZES = {
  BODY: 22,
  H1: 34,
  H2: 28,
  H3: 24,
  CODE: 20,
  COVER_TITLE: 56, // portada — título grande
  COVER_SUBTITLE: 32, // portada — subtítulo
};

// ---------------------------------------------------------------------------
// Geometría de página (DXA) — US Letter, márgenes de 1 pulgada
// ---------------------------------------------------------------------------
const PAGE = {
  WIDTH: 12240,
  HEIGHT: 15840,
  MARGIN: 1440,
  // ancho de contenido útil = WIDTH - 2*MARGIN = 9360
  CONTENT_WIDTH: 12240 - 2 * 1440,
};

// Ancho máximo (DXA) para imágenes / diagramas Mermaid
const IMAGE_MAX_WIDTH = 9000;

// ---------------------------------------------------------------------------
// Spacing de headings (DXA)
// ---------------------------------------------------------------------------
const HEADING_SPACING = {
  1: { before: 360, after: 240 },
  2: { before: 280, after: 160 },
  3: { before: 200, after: 120 },
};

// ---------------------------------------------------------------------------
// Spacing / interlineado de párrafos (DXA)
// ---------------------------------------------------------------------------
const PARAGRAPH = {
  after: 160,
  line: 280, // interlineado optimizado para "aire" entre líneas
};

const CODE = {
  line: 264,
  indentLeft: 200,
  indentRight: 200,
};

/**
 * Construye el objeto `styles` para `new Document({ styles })`.
 *
 * - `default.document` define la fuente/tamaño/color base e interlineado de
 *   todo el documento (así los párrafos normales no necesitan repetirlos).
 * - `paragraphStyles` SOBRESCRIBE los estilos built-in Heading1/2/3 usando sus
 *   IDs exactos e incluye `outlineLevel` para que la Tabla de Contenidos los
 *   recoja (regla crítica #10).
 */
function buildStyles() {
  return {
    default: {
      document: {
        run: { font: FONTS.BODY, size: SIZES.BODY, color: COLORS.TEXT_MAIN },
        paragraph: {
          spacing: { after: PARAGRAPH.after, line: PARAGRAPH.line },
        },
      },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONTS.HEAD, size: SIZES.H1, bold: true, color: COLORS.PRIMARY },
        paragraph: { spacing: HEADING_SPACING[1], outlineLevel: 0 },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONTS.HEAD, size: SIZES.H2, bold: true, color: COLORS.ACCENT },
        paragraph: { spacing: HEADING_SPACING[2], outlineLevel: 1 },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONTS.HEAD, size: SIZES.H3, bold: true, color: COLORS.H3 },
        paragraph: { spacing: HEADING_SPACING[3], outlineLevel: 2 },
      },
    ],
  };
}

module.exports = {
  buildStyles,
  COLORS,
  BOXES,
  FONTS,
  SIZES,
  PAGE,
  IMAGE_MAX_WIDTH,
  HEADING_SPACING,
  PARAGRAPH,
  CODE,
};
