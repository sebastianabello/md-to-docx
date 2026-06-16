"use strict";

/**
 * mermaid.js — Renderizado de diagramas Mermaid a PNG con fallback.
 *
 * Estrategia principal: usar el binario `mmdc` (@mermaid-js/mermaid-cli) para
 * renderizar el diagrama a PNG vía Chrome/Chromium headless. Si `mmdc` no está
 * disponible o falla (típicamente por falta de Chrome), el renderer hace
 * fallback a un bloque de código con etiqueta especial.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Localiza el binario `mmdc`. Prioriza el instalado localmente en
 * node_modules/.bin; si no, confía en el PATH.
 * @returns {string|null} ruta o nombre del binario, o null si no se encuentra.
 */
function findMmdc() {
  const local = path.join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "mmdc.cmd" : "mmdc"
  );
  if (fs.existsSync(local)) return local;

  // Probar en el PATH ejecutando `mmdc --version`.
  try {
    const probe = spawnSync("mmdc", ["--version"], {
      stdio: "ignore",
      timeout: 15000,
    });
    if (!probe.error && probe.status === 0) return "mmdc";
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Extrae un título del diagrama desde un comentario `%% título` si existe.
 * @param {string} code
 * @returns {string|null}
 */
function extractTitle(code) {
  for (const raw of code.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("%%")) {
      const title = line.replace(/^%%+/, "").trim();
      if (title) return title;
    }
  }
  return null;
}

/**
 * Lee el ancho y alto (px) de un PNG desde su cabecera IHDR.
 * @param {Buffer} buf
 * @returns {{ width: number, height: number }}
 */
function readPngSize(buf) {
  // Firma PNG (8 bytes) + longitud (4) + "IHDR" (4) → width en offset 16, height en 20.
  if (buf.length < 24) throw new Error("PNG demasiado corto para leer dimensiones");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

/**
 * Renderiza un bloque Mermaid a PNG.
 *
 * @param {string} code  contenido del bloque mermaid
 * @returns {{ ok: true, buffer: Buffer, width: number, height: number, title: string|null }
 *          | { ok: false, error: string, title: string|null }}
 */
function renderMermaid(code) {
  const title = extractTitle(code);
  const mmdc = findMmdc();
  if (!mmdc) {
    return { ok: false, error: "mmdc no está disponible", title };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2docx-mermaid-"));
  const inPath = path.join(tmpDir, "diagram.mmd");
  const outPath = path.join(tmpDir, "diagram.png");

  try {
    fs.writeFileSync(inPath, code, "utf8");
    const result = spawnSync(
      mmdc,
      ["-i", inPath, "-o", outPath, "-b", "white"],
      { stdio: "ignore", timeout: 60000 }
    );

    if (result.error) {
      return { ok: false, error: result.error.message, title };
    }
    if (result.status !== 0 || !fs.existsSync(outPath)) {
      return {
        ok: false,
        error: `mmdc terminó con código ${result.status}`,
        title,
      };
    }

    const buffer = fs.readFileSync(outPath);
    const { width, height } = readPngSize(buffer);
    return { ok: true, buffer, width, height, title };
  } catch (err) {
    return { ok: false, error: err.message, title };
  } finally {
    // Limpieza de temporales (best-effort).
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = { renderMermaid, extractTitle, isMermaidAvailable: () => findMmdc() !== null };
