"use strict";

/**
 * parser.js — Markdown → tokens (vía marked.lexer).
 *
 * Trabajamos con el AST de tokens de `marked` en lugar de su salida HTML para
 * tener control total sobre el renderizado a DOCX. Además aporta helpers de
 * alto nivel propios de este proyecto: detección de portada, de `[TOC]` y
 * clasificación de blockquotes en cajas especiales.
 */

const { marked } = require("marked");

// Activar GFM (tablas, etc.). Sin "mangle"/"headerIds" porque trabajamos con tokens.
marked.setOptions({ gfm: true, breaks: false });

/** ¿Es un token de párrafo que contiene únicamente el marcador [TOC]/[[toc]]? */
function isTocToken(token) {
  if (!token || token.type !== "paragraph") return false;
  const t = (token.text || "").trim().toLowerCase();
  return t === "[toc]" || t === "[[toc]]";
}

/**
 * Clasifica un blockquote como caja especial (tip/warning/concept) o normal
 * (quote), y separa la línea-etiqueta del cuerpo.
 *
 * @param {object} token  token blockquote de marked
 * @returns {{ type: "tip"|"warning"|"concept"|"quote", label: string|null, bodyTokens: object[] }}
 */
function classifyBlockquote(token) {
  const text = token.text || "";
  const lines = text.split(/\r?\n/);
  const firstLine = (lines[0] || "").trim();
  const upper = firstLine.toUpperCase();

  let type = "quote";
  if (
    firstLine.includes("💡") ||
    upper.includes("BUENA PRÁCTICA") ||
    upper.includes("BUENA PRACTICA")
  ) {
    type = "tip";
  } else if (
    firstLine.includes("⚠") ||
    upper.includes("ADVERTENCIA") ||
    upper.includes("ERROR COMÚN") ||
    upper.includes("ERROR COMUN")
  ) {
    type = "warning";
  } else if (
    firstLine.includes("🔎") ||
    upper.includes("QUÉ PASA") ||
    upper.includes("QUE PASA") ||
    upper.includes("CONCEPTO")
  ) {
    type = "concept";
  }

  if (type === "quote") {
    return { type, label: null, bodyTokens: token.tokens || marked.lexer(text) };
  }

  // Caja especial: la primera línea es la etiqueta; el resto, el cuerpo.
  const label = firstLine.replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
  const body = lines.slice(1).join("\n").trim();
  const bodyTokens = body ? marked.lexer(body) : [];
  return { type, label, bodyTokens };
}

/**
 * Parsea el Markdown y detecta portada + TOC explícito.
 *
 * @param {string} markdown
 * @param {object} [opts]
 * @param {boolean} [opts.detectCover=true]  si false, no detecta portada (útil
 *        para archivos que no son el primero al concatenar varios documentos).
 * @returns {{ tokens: object[], cover: {title: object, subtitle: object}|null, hasExplicitToc: boolean }}
 */
function parse(markdown, opts = {}) {
  const { detectCover = true } = opts;
  const tokens = marked.lexer(markdown);

  // --- Detección de portada: primer H1 seguido (ignorando espacios) de un H2 ---
  let cover = null;
  let bodyTokens = tokens;

  const idxFirst = tokens.findIndex((t) => t.type !== "space");
  if (
    detectCover &&
    idxFirst !== -1 &&
    tokens[idxFirst].type === "heading" &&
    tokens[idxFirst].depth === 1
  ) {
    const idxSecond = tokens.findIndex(
      (t, i) => i > idxFirst && t.type !== "space"
    );
    if (
      idxSecond !== -1 &&
      tokens[idxSecond].type === "heading" &&
      tokens[idxSecond].depth === 2
    ) {
      cover = { title: tokens[idxFirst], subtitle: tokens[idxSecond] };
      bodyTokens = tokens.filter((_, i) => i > idxSecond);
    }
  }

  const hasExplicitToc = bodyTokens.some(isTocToken);

  return { tokens: bodyTokens, cover, hasExplicitToc };
}

module.exports = { parse, classifyBlockquote, isTocToken, marked };
