"use strict";

/**
 * print.js — HTML → PDF con Chrome headless + Paged.js.
 *
 * Paged.js pagina el documento en el navegador (márgenes con cabeceras,
 * string-set, target-counter para los nº de página del índice) y Chrome lo
 * imprime. Las fuentes se cargan desde assets/fonts, así el PDF se ve igual
 * en cualquier equipo.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const { findSystemChrome } = require("../mermaid");

const NODE_MODULES = path.join(__dirname, "..", "..", "node_modules");

const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "fonts");

/**
 * @font-face de las instancias estáticas de assets/fonts (generadas con
 * scripts/build-fonts.py). Deben ser estáticas: Chrome incrusta las fuentes
 * variables como Type 3 y muchos visores las muestran con letras recortadas.
 */
function fontFaces() {
  const face = (family, file, weight, style = "normal") =>
    `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};` +
    `src:url(${pathToFileURL(path.join(FONTS_DIR, file)).href}) format("truetype");}`;
  return [
    face("Literata", "Literata-400.ttf", 400),
    face("Literata", "Literata-600.ttf", 600),
    face("Literata", "Literata-Italic-400.ttf", 400, "italic"),
    face("Literata", "Literata-Italic-600.ttf", 600, "italic"),
    ...[400, 500, 600, 700, 800].map((w) => face("Archivo", `Archivo-${w}.ttf`, w)),
    ...[400, 600, 700].map((w) => face("Archivo Compacta", `ArchivoCompacta-${w}.ttf`, w)),
    ...[800, 900].map((w) => face("Archivo Ancha", `ArchivoAncha-${w}.ttf`, w)),
    ...[400, 700].map((w) => face("JetBrains Mono", `JetBrainsMono-${w}.ttf`, w)),
  ].join("\n");
}

/**
 * Código que corre en la página: registra un handler de Paged.js que añade
 * la pestaña del módulo en el borde de cada página.
 */
function pageScript(moduleCount) {
  return `
window.PagedConfig = { auto: false };
window.__MODULOS = ${moduleCount};
document.addEventListener("DOMContentLoaded", () => {
  if (!window.__MODULOS) return;
  class PestanasModulo extends Paged.Handler {
    afterPageLayout(page) {
      if (page.querySelector(".portada, .indice")) { this.actual = null; return; }
      const marca = page.querySelector('[data-mod-index]:not([data-mod-index=""])');
      if (marca) this.actual = { i: marca.dataset.modIndex, num: marca.dataset.mod };
      if (!this.actual) return;
      const tab = document.createElement("div");
      tab.className = "pestana-pagina";
      tab.textContent = this.actual.num;
      tab.style.setProperty("--i", this.actual.i);
      tab.style.setProperty("--modulos", window.__MODULOS);
      page.appendChild(tab);
    }
  }
  Paged.registerHandlers(PestanasModulo);
});`;
}

/**
 * @param {string} html  documento completo generado por build.js
 * @param {string} output  ruta del PDF
 * @param {object} opts
 * @param {number} opts.moduleCount  nº de módulos con pestaña (0 = sin pestañas)
 * @param {string} [opts.debugHtml]  si se indica, guarda ahí el HTML intermedio
 */
async function printPdf(html, output, { moduleCount, debugHtml }) {
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch (_) {
    throw new Error("Falta puppeteer-core. Ejecuta `npm install`.");
  }
  const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || findSystemChrome();
  if (!chrome) {
    throw new Error("No se encontró Chrome/Chromium; instálalo o define PUPPETEER_EXECUTABLE_PATH.");
  }

  const polyfill = pathToFileURL(path.join(NODE_MODULES, "pagedjs", "dist", "paged.polyfill.js")).href;
  const fullHtml = html.replace(
    "</head>",
    `<style>${fontFaces()}</style>
<script>${pageScript(moduleCount)}</script>
<script src="${polyfill}"></script>
</head>`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md2pdf-"));
  const htmlPath = path.join(tmpDir, "documento.html");
  fs.writeFileSync(htmlPath, fullHtml, "utf8");
  if (debugHtml) fs.writeFileSync(debugHtml, fullHtml, "utf8");

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--allow-file-access-from-files", "--no-sandbox"],
    protocolTimeout: 15 * 60 * 1000,
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.warn(`⚠️  Error en la página: ${err.message}`));
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 0 });
    await page.evaluateHandle("document.fonts.ready");
    const pages = await page.evaluate(async () => {
      const flow = await window.PagedPolyfill.preview();
      return flow.total;
    });
    await page.pdf({
      path: output,
      preferCSSPageSize: true,
      printBackground: true,
      timeout: 0,
    });
    return { pages };
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { printPdf };
