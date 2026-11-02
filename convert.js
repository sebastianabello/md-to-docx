#!/usr/bin/env node
"use strict";

/**
 * convert.js — CLI principal.
 *
 *   node convert.js <input.md> <output.docx> [--title "Texto del header"]
 *
 * Lee el Markdown, lo parsea a tokens, los renderiza a elementos docx y
 * ensambla el documento final con portada, tabla de contenidos, header y
 * footer. Tras escribir, intenta validar el .docx si hay un validador.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  AlignmentType,
} = require("docx");

const S = require("./src/styles");
const { parse } = require("./src/parser");
const { NumberingManager } = require("./src/numbering");
const { Renderer } = require("./src/renderer");

const DEFAULT_TITLE = "Guía de Estudio DevOps";

// ---------------------------------------------------------------------------
// Parseo de argumentos
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  let title = DEFAULT_TITLE;
  let docTitle = null;
  let subtitle = null;
  let output = null;
  let html = null;

  // Lee el valor de una opción tanto en forma "--opt valor" como "--opt=valor".
  const readValue = (arg, i, name) => {
    if (arg === `--${name}` || (name.length === 1 && arg === `-${name}`)) {
      return { value: argv[i + 1], skip: true };
    }
    if (arg.startsWith(`--${name}=`)) {
      return { value: arg.slice(`--${name}=`.length), skip: false };
    }
    return null;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };

    let m;
    if ((m = readValue(arg, i, "title")) || (m = readValue(arg, i, "t"))) {
      title = m.value || title;
    } else if (
      (m = readValue(arg, i, "doc-title")) ||
      (m = readValue(arg, i, "d"))
    ) {
      docTitle = m.value || docTitle;
    } else if (
      (m = readValue(arg, i, "subtitle")) ||
      (m = readValue(arg, i, "s"))
    ) {
      subtitle = m.value || subtitle;
    } else if (
      (m = readValue(arg, i, "output")) ||
      (m = readValue(arg, i, "o"))
    ) {
      output = m.value || output;
    } else if ((m = readValue(arg, i, "html"))) {
      html = m.value || html;
    } else {
      positional.push(arg);
      continue;
    }
    if (m.skip) i += 1;
  }

  // Si no se pasó -o/--output, el último posicional es el archivo de salida.
  let inputs;
  if (output) {
    inputs = positional;
  } else {
    output = positional.pop();
    inputs = positional;
  }

  return { inputs, output, title, docTitle, subtitle, html };
}

function printUsage() {
  console.log(`
md-to-docx — Conversor de Markdown a DOCX o PDF

Uso:
  node convert.js <input.md> [más.md ...] <output.docx|output.pdf> [opciones]
  node convert.js <input.md> [más.md ...] -o <output.docx|output.pdf> [opciones]
  node convert.js <carpeta-curso> -o <output.pdf>

La extensión de salida decide el formato. En PDF se aceptan carpetas: cada
subcarpeta es un módulo y su index.md aporta los títulos.

Opciones:
  -t, --title       Texto del encabezado de cada página en DOCX (default: "${DEFAULT_TITLE}")
  -d, --doc-title   Título del documento mostrado en la portada (primera hoja)
  -s, --subtitle    Subtítulo de la portada (opcional, junto a --doc-title)
  -o, --output      Archivo de salida (alternativa al último posicional)
      --html        (PDF) Guarda también el HTML intermedio en esta ruta
  -h, --help        Muestra esta ayuda

Ejemplos:
  node convert.js guia.md salida.docx --title "Mi Curso"
  node convert.js cap1.md cap2.md cap3.md -o libro.docx -d "Manual DevOps" -s "Edición 2026"
  node convert.js ~/wiki/psoe -o psoe.pdf
`);
}

// ---------------------------------------------------------------------------
// Header / Footer
// ---------------------------------------------------------------------------
function buildHeader(title) {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: title,
            font: S.FONTS.BODY,
            color: S.COLORS.MUTED,
            size: 18,
          }),
        ],
      }),
    ],
  });
}

function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: ["Página ", PageNumber.CURRENT],
            font: S.FONTS.BODY,
            color: S.COLORS.MUTED,
            size: 18,
          }),
        ],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Validación opcional del .docx
// ---------------------------------------------------------------------------
function maybeValidate(outputPath) {
  const validator = path.join("scripts", "office", "validate.py");
  if (!fs.existsSync(validator)) {
    console.log(
      "ℹ️  Validador docx-js no encontrado (scripts/office/validate.py); se omite la validación."
    );
    return;
  }
  console.log("🔍 Validando el documento...");
  const res = spawnSync("python3", [validator, outputPath], {
    encoding: "utf8",
  });
  if (res.error) {
    console.warn(`⚠️  No se pudo ejecutar el validador: ${res.error.message}`);
    return;
  }
  if (res.stdout) console.log(res.stdout.trim());
  if (res.stderr) console.error(res.stderr.trim());
  console.log(
    res.status === 0
      ? "✅ Validación correcta."
      : `❌ Validación con errores (código ${res.status}).`
  );
}

// ---------------------------------------------------------------------------
// Salida PDF
// ---------------------------------------------------------------------------
async function convertToPdf({ inputs, output, docTitle, subtitle, html: debugHtml }) {
  const { buildHtml, escapeHtml } = require("./src/pdf/build");
  const { printPdf } = require("./src/pdf/print");
  const { renderMermaid } = require("./src/mermaid");

  const mermaidHtml = (code) => {
    const res = renderMermaid(code);
    if (!res.ok) {
      console.warn(`⚠️  Mermaid no renderizado (${res.error}); se incluye el código.`);
      return `<pre class="codigo"><code>${escapeHtml(code)}</code></pre>`;
    }
    const caption = res.title ? `<figcaption>${escapeHtml(res.title)}</figcaption>` : "";
    return `<figure class="diagrama"><img src="data:image/png;base64,${res.buffer.toString(
      "base64"
    )}" style="width:${Math.round(res.width / 3)}px" alt="">${caption}</figure>`;
  };

  console.log("🧱 Componiendo el documento...");
  const { html, modules } = buildHtml({ inputs, docTitle, subtitle, renderMermaid: mermaidHtml });
  const tabbed = modules.length > 1 && modules.every((m) => m.num) ? modules.length : 0;

  console.log("🖨️  Paginando e imprimiendo con Chrome (puede tardar con documentos largos)...");
  const { pages } = await printPdf(html, output, { moduleCount: tabbed, debugHtml });
  const size = fs.statSync(output).size;
  console.log(`✅ PDF generado: ${output} (${pages} páginas, ${(size / 1024 / 1024).toFixed(1)} MB)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { inputs, output, title, docTitle, subtitle, help } = args;

  if (help) {
    printUsage();
    return;
  }
  if (!inputs || inputs.length === 0 || !output) {
    printUsage();
    throw new Error(
      "Faltan argumentos: al menos un <input.md> y un <output.docx>."
    );
  }
  for (const f of inputs) {
    if (!fs.existsSync(f)) {
      throw new Error(`El archivo de entrada no existe: ${f}`);
    }
  }

  if (output.toLowerCase().endsWith(".pdf")) {
    await convertToPdf(args);
    return;
  }

  const numbering = new NumberingManager();
  const warnings = [];
  const renderer = new Renderer({
    numbering,
    baseDir: process.cwd(),
    warn: (m) => {
      warnings.push(m);
      console.warn(m);
    },
  });

  // Parseamos cada archivo. La portada solo se autodetecta en el primero y
  // únicamente si no se proporcionó --doc-title.
  const parsed = inputs.map((file, i) => {
    const markdown = fs.readFileSync(file, "utf8");
    const detectCover = i === 0 && !docTitle;
    return { file, ...parse(markdown, { detectCover }) };
  });

  const anyExplicitToc = parsed.some((p) => p.hasExplicitToc);

  const children = [];

  // Portada: --doc-title tiene prioridad sobre la detección automática.
  if (docTitle) {
    children.push(...renderer.renderCoverText(docTitle, subtitle));
  } else if (parsed[0].cover) {
    children.push(...renderer.renderCover(parsed[0].cover));
  }

  // Índice automático (una sola vez) si ningún archivo trae [TOC] explícito.
  if (!anyExplicitToc) children.push(...renderer.renderToc());

  // Contenido de cada archivo, con salto de página entre documentos.
  parsed.forEach((p, i) => {
    renderer.baseDir = path.dirname(path.resolve(p.file));
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...renderer.renderTokens(p.tokens));
  });

  const doc = new Document({
    creator: "md-to-docx",
    title: docTitle || title,
    styles: S.buildStyles(),
    numbering: { config: numbering.getConfig() },
    sections: [
      {
        properties: {
          page: {
            size: { width: S.PAGE.WIDTH, height: S.PAGE.HEIGHT },
            margin: {
              top: S.PAGE.MARGIN,
              bottom: S.PAGE.MARGIN,
              left: S.PAGE.MARGIN,
              right: S.PAGE.MARGIN,
            },
          },
        },
        headers: { default: buildHeader(title) },
        footers: { default: buildFooter() },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(output, buffer);
  console.log(`✅ Documento generado: ${output} (${buffer.length} bytes)`);
  if (warnings.length) {
    console.log(`⚠️  ${warnings.length} aviso(s) durante la conversión.`);
  }

  maybeValidate(output);
}

main().catch((err) => {
  console.error(`❌ Error: ${err.message}`);
  process.exitCode = 1;
});
