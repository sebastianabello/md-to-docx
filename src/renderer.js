"use strict";

/**
 * renderer.js — Convierte tokens de marked en elementos de docx-js.
 *
 * El núcleo es la clase `Renderer`, que mantiene contexto (gestor de
 * numeración, directorio base para resolver imágenes y un canal de warnings)
 * y expone `renderTokens(tokens)` → array de elementos docx
 * (Paragraph / Table / TableOfContents).
 */

const fs = require("fs");
const path = require("path");
const {
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  ImageRun,
  PageBreak,
  AlignmentType,
  TableOfContents,
} = require("docx");

const S = require("./styles");
const { classifyBlockquote, isTocToken } = require("./parser");
const { renderMermaid } = require("./mermaid");

// Ancho máximo de imagen en píxeles (9000 DXA → 450pt → 600px @96dpi).
const MAX_IMG_PX = Math.round((S.IMAGE_MAX_WIDTH / 20) * (96 / 72));

const CODE_SHADING = {
  type: ShadingType.CLEAR,
  fill: S.COLORS.CODE_BG,
  color: "auto",
};

// Prefijos de comentario por lenguaje, para atenuarlos en la tarjeta oscura.
function commentPrefixes(lang) {
  const l = (lang || "").toLowerCase();
  if (["vim", "vimscript"].includes(l)) return ['"'];
  if (["sql", "lua", "haskell", "hs"].includes(l)) return ["--"];
  if (["mermaid"].includes(l)) return ["%%"];
  if (
    ["js", "javascript", "ts", "typescript", "c", "cpp", "c++", "java", "go",
      "rust", "rs", "php", "kotlin", "swift", "scala", "json5", "dart"].includes(l)
  ) {
    return ["//"];
  }
  // Por defecto (bash, sh, shell, yaml, python, ruby, dockerfile, ini, etc.).
  return ["#"];
}

/**
 * Decodifica las entidades HTML que marked introduce en los tokens inline
 * (texto normal y codespan): &quot; &amp; &lt; &gt; &#39; y numéricas. Los
 * bloques de código cercados NO pasan por aquí porque marked los deja crudos.
 */
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // &amp; al final para no re-decodificar
}

function isCommentLine(line, prefixes) {
  const t = line.trimStart();
  if (!t) return false;
  return prefixes.some((p) => t.startsWith(p));
}

// ---------------------------------------------------------------------------
// Helpers de dimensiones de imagen (lectura de cabeceras)
// ---------------------------------------------------------------------------
function pngSize(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf) {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function jpegSize(buf) {
  let off = 2;
  while (off < buf.length - 8) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1];
    // Marcadores SOF (excepto DHT 0xC4, DAC 0xCC y los RSTn) llevan las dimensiones.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: buf.readUInt16BE(off + 5),
        width: buf.readUInt16BE(off + 7),
      };
    }
    off += 2 + buf.readUInt16BE(off + 2);
  }
  return null;
}

function imageDimensions(buf, ext) {
  switch (ext) {
    case "png":
      return pngSize(buf);
    case "gif":
      return gifSize(buf);
    case "jpg":
    case "jpeg":
      return jpegSize(buf);
    default:
      return null;
  }
}

/** Escala (intrínseco px) → tamaño de visualización respetando MAX_IMG_PX. */
function fitWidth(width, height) {
  if (!width || !height) return { width: MAX_IMG_PX, height: MAX_IMG_PX };
  const scale = width > MAX_IMG_PX ? MAX_IMG_PX / width : 1;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

// ---------------------------------------------------------------------------
// Construcción de runs
// ---------------------------------------------------------------------------
function makeRun(text, opts = {}) {
  const props = { text: text == null ? "" : text };
  if (opts.font) props.font = opts.font;
  if (opts.size) props.size = opts.size;
  if (opts.color) props.color = opts.color;
  if (opts.bold) props.bold = true;
  if (opts.italics) props.italics = true;
  if (opts.strike) props.strike = true;
  if (opts.underline) props.underline = {};
  if (opts.shading) props.shading = opts.shading;
  if (opts.break) props.break = opts.break;
  if (opts.noProof) props.noProof = true;
  return new TextRun(props);
}

class Renderer {
  /**
   * @param {object} opts
   * @param {import('./numbering').NumberingManager} opts.numbering
   * @param {string} opts.baseDir  directorio del .md (para resolver imágenes)
   * @param {(msg: string) => void} [opts.warn]
   */
  constructor({ numbering, baseDir, warn }) {
    this.numbering = numbering;
    this.baseDir = baseDir || process.cwd();
    this.warn = warn || ((m) => console.warn(m));
  }

  // --- Inline -------------------------------------------------------------
  /**
   * Convierte tokens inline de marked en runs. Solo fija las propiedades que
   * se pasan en `opts`; el resto se hereda del estilo del documento/párrafo.
   */
  inlineRuns(tokens, opts = {}) {
    const runs = [];
    for (const tk of tokens || []) {
      switch (tk.type) {
        case "text":
          if (tk.tokens && tk.tokens.length) {
            runs.push(...this.inlineRuns(tk.tokens, opts));
          } else {
            runs.push(makeRun(decodeEntities(tk.text), opts));
          }
          break;
        case "strong":
          runs.push(...this.inlineRuns(tk.tokens, { ...opts, bold: true }));
          break;
        case "em":
          runs.push(...this.inlineRuns(tk.tokens, { ...opts, italics: true }));
          break;
        case "del":
          runs.push(...this.inlineRuns(tk.tokens, { ...opts, strike: true }));
          break;
        case "codespan":
          runs.push(
            makeRun(decodeEntities(tk.text), {
              font: S.FONTS.MONO,
              size: S.SIZES.CODE,
              color: S.COLORS.INLINE_CODE,
              shading: CODE_SHADING,
              bold: opts.bold,
              italics: opts.italics,
            })
          );
          break;
        case "link":
          runs.push(
            new ExternalHyperlink({
              link: tk.href,
              children: this.inlineRuns(tk.tokens, {
                ...opts,
                color: S.COLORS.ACCENT,
                underline: true,
              }),
            })
          );
          break;
        case "br":
          runs.push(makeRun("", { ...opts, break: 1 }));
          break;
        case "image":
          // Imagen inline: mostramos el texto alternativo en itálica.
          runs.push(makeRun(tk.text || tk.title || "", { ...opts, italics: true }));
          break;
        case "escape":
        case "html":
          runs.push(makeRun(decodeEntities(tk.text), opts));
          break;
        default:
          if (tk.text) runs.push(makeRun(decodeEntities(tk.text), opts));
      }
    }
    return runs;
  }

  // --- Dispatch -----------------------------------------------------------
  renderTokens(tokens) {
    const out = [];
    for (const token of tokens || []) {
      out.push(...this.renderToken(token));
    }
    return out;
  }

  renderToken(token) {
    switch (token.type) {
      case "space":
        return [];
      case "heading":
        return this.renderHeading(token);
      case "paragraph":
        return this.renderParagraph(token);
      case "list":
        return this.renderList(token, 0, null);
      case "code":
        return token.lang && token.lang.trim().toLowerCase() === "mermaid"
          ? this.renderMermaidBlock(token)
          : this.renderCodeBlock(token);
      case "table":
        return this.renderTable(token);
      case "blockquote":
        return this.renderBlockquote(token);
      case "hr":
        return [this.renderHr()];
      case "html":
        return []; // HTML crudo no soportado: se omite silenciosamente
      default:
        if (token.text) {
          return [new Paragraph({ children: [makeRun(token.text)] })];
        }
        return [];
    }
  }

  // --- Bloques ------------------------------------------------------------
  renderHeading(token) {
    const level = Math.min(token.depth || 1, 3);
    const headingLevel = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
    }[level];
    // Solo fijamos la fuente a nivel de run; tamaño/color/negrita vienen del
    // estilo Heading sobrescrito en styles.buildStyles().
    return [
      new Paragraph({
        heading: headingLevel,
        children: this.inlineRuns(token.tokens, { font: S.FONTS.HEAD }),
      }),
    ];
  }

  renderParagraph(token) {
    if (isTocToken(token)) return this.renderToc();

    // Párrafo que es solo una imagen → imagen de bloque.
    if (
      token.tokens &&
      token.tokens.length === 1 &&
      token.tokens[0].type === "image"
    ) {
      return this.renderImage(token.tokens[0]);
    }

    return [new Paragraph({ children: this.inlineRuns(token.tokens) })];
  }

  renderToc() {
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [makeRun("Tabla de Contenidos", { font: S.FONTS.HEAD })],
      }),
      new TableOfContents("Tabla de Contenidos", {
        hyperlink: true,
        headingStyleRange: "1-3",
      }),
      new Paragraph({ children: [new PageBreak()] }),
    ];
  }

  renderImage(imgToken, captionText) {
    const src = imgToken.href || "";
    const abs = path.isAbsolute(src) ? src : path.resolve(this.baseDir, src);
    const ext = path.extname(abs).slice(1).toLowerCase();

    if (ext === "svg") {
      this.warn(`⚠️  Imagen SVG no soportada directamente, se omite: ${src}`);
      return [];
    }
    if (!fs.existsSync(abs)) {
      this.warn(`⚠️  Imagen no encontrada, se omite: ${src}`);
      return [];
    }

    let buffer;
    try {
      buffer = fs.readFileSync(abs);
    } catch (err) {
      this.warn(`⚠️  No se pudo leer la imagen ${src}: ${err.message}`);
      return [];
    }

    const typeMap = { png: "png", jpg: "jpg", jpeg: "jpg", gif: "gif" };
    const type = typeMap[ext];
    if (!type) {
      this.warn(`⚠️  Formato de imagen no soportado (${ext}), se omite: ${src}`);
      return [];
    }

    const dims = imageDimensions(buffer, ext);
    const size = fitWidth(dims && dims.width, dims && dims.height);

    const out = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: captionText ? 40 : 160 },
        children: [
          new ImageRun({ data: buffer, type, transformation: size }),
        ],
      }),
    ];
    const caption = captionText || imgToken.text;
    if (caption) {
      out.push(this.captionParagraph(caption));
    }
    return out;
  }

  captionParagraph(text) {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        makeRun(text, {
          font: S.FONTS.BODY,
          size: 18,
          color: S.COLORS.MUTED,
          italics: true,
        }),
      ],
    });
  }

  renderCodeBlock(token, opts = {}) {
    const lang = (token.lang || "").trim();
    const lines = (token.text || "").replace(/\n$/, "").split("\n");
    const inner = [];

    // Etiqueta descriptiva opcional (p. ej. fallback de Mermaid): línea tenue.
    // No se muestra ninguna etiqueta de lenguaje: el bloque va limpio.
    if (opts.label) {
      inner.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            makeRun(opts.label, {
              font: S.FONTS.MONO,
              size: S.SIZES.CODE,
              color: opts.labelColor || S.COLORS.CODE_COMMENT,
              italics: true,
              noProof: true,
            }),
          ],
        })
      );
    }

    // Líneas de código. Los comentarios se colorean en verde (estilo terminal);
    // se desactiva el corrector ortográfico para evitar subrayados rojos.
    const prefixes = commentPrefixes(lang);
    lines.forEach((line) => {
      const color = isCommentLine(line, prefixes)
        ? S.COLORS.CODE_COMMENT
        : S.COLORS.CODE_TEXT;
      inner.push(
        new Paragraph({
          spacing: { after: 0, line: S.CODE.line },
          children: [
            makeRun(line.length ? line : " ", {
              font: S.FONTS.MONO,
              size: S.SIZES.CODE,
              color,
              noProof: true,
            }),
          ],
        })
      );
    });

    // Bloque limpio: una celda oscura sin bordes (solo el fondo tipo terminal).
    const noBorder = { style: BorderStyle.NONE, size: 0, color: "auto" };
    const card = new Table({
      width: { size: S.PAGE.CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [S.PAGE.CONTENT_WIDTH],
      borders: {
        top: noBorder,
        left: noBorder,
        bottom: noBorder,
        right: noBorder,
        insideHorizontal: noBorder,
        insideVertical: noBorder,
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: S.PAGE.CONTENT_WIDTH, type: WidthType.DXA },
              margins: { top: 160, bottom: 160, left: 240, right: 240 },
              shading: {
                type: ShadingType.CLEAR,
                fill: S.COLORS.CODE_CARD_BG,
                color: "auto",
              },
              children: inner,
            }),
          ],
        }),
      ],
    });

    return [card, new Paragraph({ spacing: { after: 120 }, children: [] })];
  }

  renderMermaidBlock(token) {
    const res = renderMermaid(token.text || "");
    if (res.ok) {
      const size = fitWidth(res.width, res.height);
      const out = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: res.title ? 40 : 160 },
          children: [
            new ImageRun({
              data: res.buffer,
              type: "png",
              transformation: size,
            }),
          ],
        }),
      ];
      if (res.title) out.push(this.captionParagraph(res.title));
      // Además de la imagen, incluimos el código fuente del diagrama por si la
      // imagen queda pequeña o se distorsiona al ampliarla.
      out.push(
        ...this.renderCodeBlock(token, {
          label: `📊 Código del diagrama (Mermaid)${
            res.title ? ` — ${res.title}` : ""
          }`,
        })
      );
      return out;
    }

    // Fallback: render como código con etiqueta especial.
    this.warn(
      `⚠️  Mermaid no se pudo renderizar como imagen (${res.error}); se inserta como código.`
    );
    const label = `📊 Diagrama (sintaxis Mermaid)${
      res.title ? ` — ${res.title}` : ""
    }`;
    return this.renderCodeBlock(token, {
      label,
      labelColor: S.COLORS.ACCENT,
    });
  }

  renderTable(token) {
    const header = token.header || [];
    const rows = token.rows || [];
    const numCols = header.length || (rows[0] ? rows[0].length : 1);

    // Anchos equiproporcionales que suman exactamente CONTENT_WIDTH.
    const base = Math.floor(S.PAGE.CONTENT_WIDTH / numCols);
    const columnWidths = Array.from({ length: numCols }, (_, i) =>
      i === numCols - 1 ? S.PAGE.CONTENT_WIDTH - base * (numCols - 1) : base
    );

    const alignFor = (i) => {
      const a = token.align && token.align[i];
      if (a === "center") return AlignmentType.CENTER;
      if (a === "right") return AlignmentType.RIGHT;
      return AlignmentType.LEFT;
    };

    const borderSide = { style: BorderStyle.SINGLE, size: 1, color: S.COLORS.BORDER_SOFT };
    const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };

    const makeCell = (cell, colIdx, isHeader) => {
      const runOpts = isHeader
        ? { font: S.FONTS.HEAD, color: S.COLORS.PRIMARY, bold: true }
        : {};
      const runs =
        cell && cell.tokens
          ? this.inlineRuns(cell.tokens, runOpts)
          : [makeRun(decodeEntities((cell && cell.text) || ""), runOpts)];
      return new TableCell({
        width: { size: columnWidths[colIdx], type: WidthType.DXA },
        margins: cellMargins,
        shading: {
          type: ShadingType.CLEAR,
          fill: isHeader ? S.COLORS.LIGHT : S.COLORS.WHITE,
          color: "auto",
        },
        children: [
          new Paragraph({
            alignment: alignFor(colIdx),
            spacing: { after: 0 },
            children: runs,
          }),
        ],
      });
    };

    const tableRows = [];
    if (header.length) {
      tableRows.push(
        new TableRow({
          tableHeader: true,
          children: header.map((c, i) => makeCell(c, i, true)),
        })
      );
    }
    rows.forEach((row) => {
      tableRows.push(
        new TableRow({
          children: row.map((c, i) => makeCell(c, i, false)),
        })
      );
    });

    const table = new Table({
      width: { size: S.PAGE.CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths,
      borders: {
        top: borderSide,
        bottom: borderSide,
        left: borderSide,
        right: borderSide,
        insideHorizontal: borderSide,
        insideVertical: borderSide,
      },
      rows: tableRows,
    });

    return [table, new Paragraph({ spacing: { after: 120 }, children: [] })];
  }

  renderBlockquote(token) {
    const { type, label, bodyTokens } = classifyBlockquote(token);
    const box = S.BOXES[type] || S.BOXES.quote;

    const inner = [];
    if (label) {
      inner.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            makeRun(label, { font: S.FONTS.HEAD, bold: true, color: box.label }),
          ],
        })
      );
    }
    inner.push(...this.renderTokens(bodyTokens));
    if (inner.length === 0) inner.push(new Paragraph({ children: [] }));

    // Orden de bordes: top, left, bottom, right (regla crítica #9).
    const borders = {
      top: { style: BorderStyle.SINGLE, size: 4, color: S.COLORS.BORDER_SOFT },
      left: { style: BorderStyle.SINGLE, size: 18, color: box.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: S.COLORS.BORDER_SOFT },
      right: { style: BorderStyle.SINGLE, size: 4, color: S.COLORS.BORDER_SOFT },
    };

    const table = new Table({
      width: { size: S.PAGE.CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [S.PAGE.CONTENT_WIDTH],
      borders,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: S.PAGE.CONTENT_WIDTH, type: WidthType.DXA },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              shading: { type: ShadingType.CLEAR, fill: box.fill, color: "auto" },
              children: inner,
            }),
          ],
        }),
      ],
    });

    return [table, new Paragraph({ spacing: { after: 120 }, children: [] })];
  }

  renderHr() {
    return new Paragraph({
      children: [],
      spacing: { before: 120, after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: S.COLORS.ACCENT },
      },
    });
  }

  // --- Listas -------------------------------------------------------------
  renderList(token, depth = 0, inheritedRef = null) {
    const ordered = !!token.ordered;
    const ref = ordered
      ? depth > 0 && inheritedRef
        ? inheritedRef
        : this.numbering.newOrderedReference()
      : this.numbering.bulletReference;
    const level = Math.min(depth, 2);

    const out = [];
    for (const item of token.items || []) {
      let lineUsed = false;
      for (const child of item.tokens || []) {
        if (child.type === "list") {
          out.push(
            ...this.renderList(child, depth + 1, child.ordered ? ref : null)
          );
        } else if (child.type === "text" || child.type === "paragraph") {
          const runs =
            child.tokens && child.tokens.length
              ? this.inlineRuns(child.tokens)
              : [makeRun(decodeEntities(child.text || ""))];
          if (!lineUsed) {
            out.push(
              new Paragraph({ numbering: { reference: ref, level }, children: runs })
            );
            lineUsed = true;
          } else {
            out.push(
              new Paragraph({
                indent: { left: 720 * (level + 1) },
                spacing: { after: 60 },
                children: runs,
              })
            );
          }
        } else {
          // Otros bloques dentro del ítem (código, blockquote, etc.).
          out.push(...this.renderToken(child));
        }
      }
      if (!lineUsed) {
        out.push(
          new Paragraph({ numbering: { reference: ref, level }, children: [] })
        );
      }
    }
    return out;
  }

  // --- Portada ------------------------------------------------------------
  /** Portada a partir de tokens (H1 + H2 detectados en el Markdown). */
  renderCover(cover) {
    return this.buildCover(
      this.inlineRuns(cover.title.tokens, {
        font: S.FONTS.HEAD,
        size: S.SIZES.COVER_TITLE,
        color: S.COLORS.PRIMARY,
        bold: true,
      }),
      cover.subtitle
        ? this.inlineRuns(cover.subtitle.tokens, {
            font: S.FONTS.HEAD,
            size: S.SIZES.COVER_SUBTITLE,
            color: S.COLORS.ACCENT,
          })
        : null
    );
  }

  /** Portada a partir de texto plano (parámetros --doc-title / --subtitle). */
  renderCoverText(title, subtitle) {
    return this.buildCover(
      [
        makeRun(title, {
          font: S.FONTS.HEAD,
          size: S.SIZES.COVER_TITLE,
          color: S.COLORS.PRIMARY,
          bold: true,
        }),
      ],
      subtitle
        ? [
            makeRun(subtitle, {
              font: S.FONTS.HEAD,
              size: S.SIZES.COVER_SUBTITLE,
              color: S.COLORS.ACCENT,
            }),
          ]
        : null
    );
  }

  buildCover(titleRuns, subtitleRuns) {
    const out = [
      new Paragraph({ spacing: { before: 2400 }, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: titleRuns,
      }),
    ];
    if (subtitleRuns) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: subtitleRuns,
        })
      );
    }
    out.push(new Paragraph({ children: [new PageBreak()] }));
    return out;
  }
}

module.exports = { Renderer };
