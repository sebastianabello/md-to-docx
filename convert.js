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
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title" || arg === "-t") {
      title = argv[i + 1] || title;
      i += 1;
    } else if (arg.startsWith("--title=")) {
      title = arg.slice("--title=".length);
    } else if (arg === "--help" || arg === "-h") {
      positional.length = 0;
      return { help: true };
    } else {
      positional.push(arg);
    }
  }
  return { input: positional[0], output: positional[1], title };
}

function printUsage() {
  console.log(`
md-to-docx — Conversor de Markdown a DOCX profesional

Uso:
  node convert.js <input.md> <output.docx> [--title "Texto del header"]

Opciones:
  -t, --title    Texto del encabezado de página (default: "${DEFAULT_TITLE}")
  -h, --help     Muestra esta ayuda
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
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { input, output, title, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    return;
  }
  if (!input || !output) {
    printUsage();
    throw new Error("Faltan argumentos: <input.md> y <output.docx> son obligatorios.");
  }
  if (!fs.existsSync(input)) {
    throw new Error(`El archivo de entrada no existe: ${input}`);
  }

  const markdown = fs.readFileSync(input, "utf8");
  const { tokens, cover, hasExplicitToc } = parse(markdown);

  const numbering = new NumberingManager();
  const warnings = [];
  const renderer = new Renderer({
    numbering,
    baseDir: path.dirname(path.resolve(input)),
    warn: (m) => {
      warnings.push(m);
      console.warn(m);
    },
  });

  const children = [];
  if (cover) children.push(...renderer.renderCover(cover));
  // Si no hay [TOC] explícito, insertamos uno automático tras la portada.
  if (!hasExplicitToc) children.push(...renderer.renderToc());
  children.push(...renderer.renderTokens(tokens));

  const doc = new Document({
    creator: "md-to-docx",
    title,
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
