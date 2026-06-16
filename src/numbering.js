"use strict";

/**
 * numbering.js — Gestión de referencias de numeración para listas.
 *
 * Regla crítica de docx-js: cada lista numerada independiente necesita su
 * propia referencia en el config de `numbering`. Si dos listas comparten la
 * misma referencia, la segunda continúa el conteo de la primera. Para que
 * cada lista numerada empiece en 1 generamos referencias únicas
 * (`numbers1`, `numbers2`, …) bajo demanda.
 *
 * Las viñetas, en cambio, sí comparten una única referencia (`bullets`) con
 * varios niveles de anidamiento, porque reiniciar bullets no es relevante.
 */

const { LevelFormat, AlignmentType } = require("docx");

const BULLET_REF = "bullets";

// Caracteres de viñeta por nivel de anidamiento.
const BULLET_CHARS = ["•", "◦", "▪"]; // • ◦ ▪

function buildBulletLevels() {
  return BULLET_CHARS.map((char, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: char,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: { left: 720 * (level + 1), hanging: 360 },
      },
    },
  }));
}

// Niveles decimales para listas numeradas (hasta 3 de profundidad).
function buildOrderedLevels() {
  return [0, 1, 2].map((level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: { left: 720 * (level + 1), hanging: 360 },
      },
    },
  }));
}

class NumberingManager {
  constructor() {
    this._orderedCount = 0;
    this._configs = [
      {
        reference: BULLET_REF,
        levels: buildBulletLevels(),
      },
    ];
  }

  /** Referencia compartida para todas las viñetas. */
  get bulletReference() {
    return BULLET_REF;
  }

  /**
   * Crea y registra una nueva referencia para una lista numerada, de forma
   * que su conteo empiece en 1 independientemente de otras listas.
   * @returns {string} la referencia generada (p. ej. "numbers3")
   */
  newOrderedReference() {
    this._orderedCount += 1;
    const reference = `numbers${this._orderedCount}`;
    this._configs.push({
      reference,
      levels: buildOrderedLevels(),
    });
    return reference;
  }

  /** Config completo para `new Document({ numbering: { config } })`. */
  getConfig() {
    return this._configs;
  }
}

module.exports = { NumberingManager, BULLET_REF };
