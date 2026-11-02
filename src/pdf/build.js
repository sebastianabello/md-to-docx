"use strict";

/**
 * build.js — Markdown → HTML paginable (para imprimir a PDF con Paged.js).
 *
 * Entiende la estructura de una wiki tipo Obsidian:
 *   - frontmatter YAML (title, tags, updated)
 *   - wikilinks [[ruta.md|Etiqueta]] → enlaces internos con nº de página
 *   - notas al pie [^n] → referencias a la sección «Fuentes»
 *   - carpeta de curso: una subcarpeta por módulo + index.md con títulos
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

marked.setOptions({ gfm: true, breaks: false });

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const slugify = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Clave estable de un artículo: "carpeta/archivo" sin extensión. */
const articleKey = (file) =>
  `${path.basename(path.dirname(file))}/${path.basename(file, ".md")}`;

/** Separa el frontmatter YAML simple (clave: valor) del cuerpo. */
function splitFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: markdown };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^\[.*\]$/.test(value)) {
      value = value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
    }
    meta[kv[1]] = value;
  }
  return { meta, body: markdown.slice(m[0].length) };
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || "";
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

// ---------------------------------------------------------------------------
// Carga de contenido
// ---------------------------------------------------------------------------

/**
 * Lee index.md de un curso: H1 (título), primer párrafo (descripción),
 * H2 "NN — Título" por módulo y la descripción de cada artículo enlazado.
 */
function readCourseIndex(dir) {
  const file = path.join(dir, "index.md");
  const out = { title: null, intro: null, modules: {}, descriptions: {} };
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, "utf8");

  const h1 = text.match(/^# (.+)$/m);
  if (h1) out.title = h1[1].replace(/^Índice\s*[—–-]\s*/i, "").trim();
  const intro = text.match(/^# .+\n+([^#\n-][^\n]+)/m);
  if (intro) out.intro = intro[1].trim();

  for (const m of text.matchAll(/^## (\d+)\s*[—–-]\s*(.+)$/gm)) {
    out.modules[m[1]] = m[2].trim();
  }
  for (const m of text.matchAll(/^- \[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*-\s*(.+?)(?:\s*\|\s*[\d-]+)?$/gm)) {
    out.descriptions[articleKey(m[1])] = m[2].trim();
  }
  return out;
}

/** Humaniza un nombre de carpeta: "07-google-threat-intelligence" → "Google threat intelligence". */
function humanize(name) {
  const s = name.replace(/^\d+[-_ ]*/, "").replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Convierte las entradas del CLI (archivos y/o carpetas de curso) en una
 * lista de módulos con sus artículos.
 *
 * @returns {{ course: object|null, modules: Array<{num, title, description, articles: string[]}> }}
 */
function collect(inputs) {
  const modules = [];
  let course = null;

  for (const input of inputs) {
    const stat = fs.statSync(input);
    if (!stat.isDirectory()) {
      if (!modules.length || modules[modules.length - 1].num !== null) {
        modules.push({ num: null, title: null, articles: [] });
      }
      modules[modules.length - 1].articles.push(path.resolve(input));
      continue;
    }

    const index = readCourseIndex(input);
    course = course || { ...index, dir: path.resolve(input) };
    const subdirs = fs
      .readdirSync(input)
      .filter((name) => !name.startsWith(".") && fs.statSync(path.join(input, name)).isDirectory())
      .sort();

    for (const sub of subdirs) {
      const articles = fs
        .readdirSync(path.join(input, sub))
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => path.resolve(input, sub, f));
      if (!articles.length) continue;
      const num = (sub.match(/^(\d+)/) || [])[1] || null;
      modules.push({
        num,
        title: (num && index.modules[num]) || humanize(sub),
        articles,
      });
    }
  }
  return { course, modules };
}

// ---------------------------------------------------------------------------
// Markdown de un artículo → HTML
// ---------------------------------------------------------------------------

/** Clasifica un blockquote por su primera palabra en negrita. */
function quoteKind(html) {
  const text = html.replace(/<[^>]+>/g, "").trim().toLowerCase();
  if (text.startsWith("⚠") || /^(advertencia|atención|actualización)/.test(text)) return "aviso";
  if (/^(discrepancia|errata|error|nota|diferencia|«)/.test(text)) return "fuente";
  if (text.startsWith("💡") || text.startsWith("buena práctica")) return "consejo";
  return "cita";
}

const SECTION_KINDS = [
  [/^claves? (para|del) (el )?examen/i, "examen"],
  [/^verificación/i, "verificacion"],
  [/^ver también/i, "ver-tambien"],
  [/^fuentes/i, "fuentes"],
  [/^(repaso|preguntas)/i, "repaso"],
];
const sectionKind = (title) =>
  (SECTION_KINDS.find(([re]) => re.test(title)) || [])[1] || "";

class ArticleRenderer {
  /**
   * @param {object} ctx
   * @param {Map<string,string>} ctx.ids  clave de artículo → id del ancla
   * @param {(code: string) => string} ctx.renderMermaid  devuelve HTML
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  render(file, { moduleIndex, moduleNum }) {
    const { meta, body } = splitFrontmatter(fs.readFileSync(file, "utf8"));
    const id = this.ctx.ids.get(articleKey(file));
    const footIds = (n) => `${id}--fn-${n}`;

    // Definiciones de notas al pie: se extraen y se pintan aparte en «Fuentes».
    const footnotes = [];
    let md = body.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (_, n, text) => {
      footnotes.push({ n, text });
      return "";
    });
    md = md.replace(/\[\^([^\]]+)\]/g, (_, n) =>
      `<sup class="ref"><a href="#${footIds(n)}">${escapeHtml(n)}</a></sup>`
    );
    md = md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) =>
      this.wikilink(target, label)
    );

    // Título: el H1 del cuerpo o el del frontmatter.
    let title = meta.title || path.basename(file, ".md");
    md = md.replace(/^# (.+)\r?\n/m, (_, h1) => {
      title = h1.trim();
      return "";
    });

    const sectionsHtml = this.renderSections(md);
    const fuentes = footnotes.length
      ? `<ol class="notas">${footnotes
          .map(
            (f) =>
              `<li id="${footIds(f.n)}" value="${Number(f.n) || ""}">${this.inline(
                this.shortenSourcePath(f.text)
              )}</li>`
          )
          .join("")}</ol>`
      : "";

    const lesson = (path.basename(file).match(/^(\d+)/) || [])[1];
    const metaBits = [
      lesson ? `<span>Lección ${Number(lesson)}</span>` : "",
      meta.updated ? `<span>Actualizado el ${formatDate(meta.updated)}</span>` : "",
    ].join("");

    return `
<article class="articulo" id="${id}" data-mod-index="${moduleIndex}" data-mod="${moduleNum || ""}">
  <header class="articulo-cabecera">
    <h1 class="articulo-titulo">${this.inline(title)}</h1>
    ${metaBits ? `<p class="articulo-meta">${metaBits}</p>` : ""}
  </header>
  ${sectionsHtml.replace("<!--FUENTES-->", fuentes)}
  ${fuentes && !sectionsHtml.includes("<!--FUENTES-->") ? `<section class="seccion seccion--fuentes"><h2>Fuentes</h2>${fuentes}</section>` : ""}
</article>`;
  }

  /** Agrupa el contenido por H2 en <section> con una clase según el título. */
  renderSections(md) {
    const tokens = marked.lexer(md);
    const groups = [{ heading: null, tokens: [] }];
    for (const t of tokens) {
      if (t.type === "heading" && t.depth === 2) groups.push({ heading: t, tokens: [] });
      else groups[groups.length - 1].tokens.push(t);
    }

    return groups
      .map(({ heading, tokens: toks }) => {
        toks.links = tokens.links;
        let inner = this.blocks(toks);
        if (!heading) return inner.trim() ? `<div class="entrada">${inner}</div>` : "";
        const kind = sectionKind(heading.text);
        if (kind === "fuentes") inner = "<!--FUENTES-->";
        return `<section class="seccion${kind ? ` seccion--${kind}` : ""}">
  <h2><span>${this.inline(heading.text)}</span></h2>
  ${inner}
</section>`;
      })
      .join("\n");
  }

  /** Renderiza tokens de bloque con los ajustes propios del diseño. */
  blocks(tokens) {
    const ctx = this.ctx;
    const renderer = new marked.Renderer();
    renderer.code = (code, lang) => {
      if ((lang || "").trim().toLowerCase() === "mermaid") return ctx.renderMermaid(code);
      return `<pre class="codigo"><code>${escapeHtml(code)}</code></pre>`;
    };
    renderer.blockquote = (quote) =>
      `<aside class="nota nota--${quoteKind(quote)}">${quote}</aside>`;
    renderer.table = (header, body) =>
      `<div class="tabla"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    renderer.link = (href, title, text) => {
      const ext = /^https?:/.test(href || "");
      return `<a href="${escapeHtml(href || "")}"${ext ? ' class="ext"' : ""}>${text}</a>`;
    };
    return marked.parser(tokens, { renderer, gfm: true });
  }

  inline(text) {
    return marked.parseInline(text, { gfm: true });
  }

  wikilink(target, label) {
    // Dentro de tablas GFM el separador se escribe escapado: [[ruta.md\|Etiqueta]].
    const key = articleKey(target.trim().replace(/\\$/, ""));
    const id = this.ctx.ids.get(key);
    const text = escapeHtml(label || path.basename(target, ".md"));
    return id ? `<a class="xref" href="#${id}">${text}</a>` : `<span class="xref-roto">${text}</span>`;
  }

  /** «Título» — `raw/a/b/c.md` → deja solo el nombre del archivo. */
  shortenSourcePath(text) {
    return text.replace(/`[^`]*\/([^/`]+)`/g, "`$1`");
  }
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------

function coverHtml({ title, subtitle, intro, date, modules }) {
  // El título grande se ajusta a su longitud para ocupar el ancho útil.
  // Archivo expandida negra ocupa ~0,85 em por carácter; el ancho útil es ~145 mm.
  const size = Math.max(36, Math.min(150, Math.round((145 / 0.3528) / (0.85 * Math.max(title.length, 1)))));
  return `
<section class="portada">
  <p class="portada-sub">${escapeHtml(subtitle || "")}</p>
  <h1 class="portada-titulo" style="font-size:${size}pt">${escapeHtml(title)}</h1>
  ${intro ? `<p class="portada-intro">${escapeHtml(intro)}</p>` : ""}
  <p class="portada-fecha">${escapeHtml(date)}</p>
  ${modules.length > 1 ? `<div class="portada-pestanas">${modules
    .map((m, i) => `<span class="pestana" style="--i:${i}">${escapeHtml(m.num || String(i + 1))}</span>`)
    .join("")}</div>` : ""}
</section>`;
}

function tocHtml(modules, ids) {
  const items = modules
    .map((m) => {
      const arts = m.articles
        .map((f) => {
          const id = ids.get(articleKey(f));
          return `<li><a href="#${id}"><span class="toc-texto">${escapeHtml(m.titles.get(f))}</span></a></li>`;
        })
        .join("");
      const head = m.num
        ? `<h2 class="toc-modulo"><a href="#mod-${m.num}"><span class="toc-num">${m.num}</span><span class="toc-texto">${escapeHtml(m.title)}</span></a></h2>`
        : "";
      return `<div class="toc-grupo">${head}<ol class="toc-lista">${arts}</ol></div>`;
    })
    .join("");
  return `<nav class="indice"><h1 class="indice-titulo">Contenido</h1>${items}</nav>`;
}

function dividerHtml(m, index, ids, descriptions) {
  const arts = m.articles
    .map((f) => {
      const key = articleKey(f);
      const desc = descriptions[key];
      return `<li><a href="#${ids.get(key)}">${escapeHtml(m.titles.get(f))}</a>${
        desc ? `<p>${marked.parseInline(desc)}</p>` : ""
      }</li>`;
    })
    .join("");
  return `
<section class="separador" id="mod-${m.num}" data-mod-index="${index}" data-mod="${m.num}">
  <p class="separador-num">${escapeHtml(m.num)}</p>
  <h1 class="separador-titulo">${escapeHtml(m.title)}</h1>
  <ul class="separador-lista">${arts}</ul>
</section>`;
}

/** Título de un artículo sin renderizarlo entero (para índice y separadores). */
function peekTitle(file) {
  const { meta, body } = splitFrontmatter(fs.readFileSync(file, "utf8"));
  const h1 = body.match(/^# (.+)$/m);
  return (h1 && h1[1].trim()) || meta.title || path.basename(file, ".md");
}

/**
 * @param {object} opts
 * @param {string[]} opts.inputs
 * @param {string|null} opts.docTitle
 * @param {string|null} opts.subtitle
 * @param {(code: string) => string} opts.renderMermaid
 * @returns {{ html: string, modules: object[] }}
 */
function buildHtml({ inputs, docTitle, subtitle, renderMermaid }) {
  const { course, modules } = collect(inputs);
  if (!modules.length) throw new Error("No se encontraron archivos .md en las entradas.");

  const ids = new Map();
  for (const m of modules) {
    m.titles = new Map(m.articles.map((f) => [f, peekTitle(f)]));
    for (const f of m.articles) ids.set(articleKey(f), `a-${slugify(articleKey(f))}`);
  }

  // Portada: --doc-title manda; si no, el H1 de index.md ("PSOE (Nombre largo)").
  let title = docTitle;
  let sub = subtitle;
  if (!title && course && course.title) {
    const paren = course.title.match(/^(.+?)\s*\((.+)\)$/);
    title = paren ? paren[1] : course.title;
    sub = sub || (paren ? paren[2] : null);
  }
  if (!title) title = modules[0].titles.get(modules[0].articles[0]);
  const intro = course && course.intro ? course.intro.split(/(?<=\.)\s/)[0] : null;
  const date = new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

  const renderer = new ArticleRenderer({ ids, renderMermaid });
  const withDividers = modules.length > 1 && modules.every((m) => m.num);
  const total = modules.reduce((n, m) => n + m.articles.length, 0);

  const body = [
    coverHtml({ title, subtitle: sub, intro, date, modules: withDividers ? modules : [] }),
    total > 1 ? tocHtml(modules, ids) : "",
    ...modules.map((m, i) =>
      [
        withDividers ? dividerHtml(m, i, ids, (course && course.descriptions) || {}) : "",
        ...m.articles.map((f) =>
          renderer.render(f, { moduleIndex: withDividers ? i : "", moduleNum: m.num })
        ),
      ].join("\n")
    ),
  ].join("\n");

  const css = fs.readFileSync(path.join(__dirname, "theme.css"), "utf8");
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body style="--modulos:${withDividers ? modules.length : 0}">
${body}
</body>
</html>`;
  return { html, modules, title };
}

module.exports = { buildHtml, splitFrontmatter, slugify, escapeHtml };
