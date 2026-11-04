// Lossless snapshot of a model for this editor.
//
// A .mdl file is the interchange format Vensim opens. It does not hold this canvas exactly:
// sketch coordinates are integer centers, a relation's dragged curve is written as one waypoint
// the parser never reads back, and Euler versus RK4 is not an equation-section field. This
// document is the in-memory model, so positions, sizes, bends, ids, simulation settings, and
// custom graphs come back unchanged.

import { ModelError } from "./errors.js";
import type { Model } from "./types.js";

export const NATIVE_FORMAT = "vensim-ai-model";
export const NATIVE_VERSION = 1;

export function writeNativeModel(model: Model): string {
  return `${JSON.stringify({ format: NATIVE_FORMAT, version: NATIVE_VERSION, model }, null, 2)}\n`;
}

export function parseNativeModel(text: string): Model {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ModelError("This file is not a Vensim AI model.");
  }
  if (!isRecord(parsed) || parsed.format !== NATIVE_FORMAT) {
    throw new ModelError("This file is not a Vensim AI model.");
  }
  if (parsed.version !== NATIVE_VERSION) {
    throw new ModelError(`This file uses format version ${String(parsed.version)}. This editor reads version ${NATIVE_VERSION}.`);
  }
  if (!isModel(parsed.model)) {
    throw new ModelError("This Vensim AI model is missing part of the diagram.");
  }
  return parsed.model;
}

function isModel(value: unknown): value is Model {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string") return false;
  if (!isVariableArray(value.stocks, "stock")) return false;
  if (!isVariableArray(value.flows, "flow")) return false;
  if (!isVariableArray(value.auxiliaries, "auxiliary")) return false;
  if (!Array.isArray(value.connectors) || !value.connectors.every(isConnector)) return false;
  if (!Array.isArray(value.comments) || !value.comments.every(isComment)) return false;
  if (!Array.isArray(value.pinnedGraphs) || !value.pinnedGraphs.every((name) => typeof name === "string")) return false;
  if (!Array.isArray(value.customOutput)) return false;
  if (typeof value.vensimFileTail !== "string") return false;
  if (!Array.isArray(value.unsupportedRaw) || !value.unsupportedRaw.every((row) => typeof row === "string")) return false;
  return isSimSpec(value.simSpec);
}

function isVariableArray(value: unknown, kind: "stock" | "flow" | "auxiliary"): boolean {
  return Array.isArray(value) && value.every((item) => {
    if (!isRecord(item) || item.kind !== kind || !isBase(item)) return false;
    if (kind === "stock") return typeof item.initialEquation === "string" && isStringArray(item.inflows) && isStringArray(item.outflows);
    if (kind === "flow") {
      return typeof item.equation === "string" && (item.from === null || typeof item.from === "string") && (item.to === null || typeof item.to === "string");
    }
    return typeof item.equation === "string";
  });
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBase(value: Record<string, unknown>): boolean {
  return typeof value.id === "string" && typeof value.name === "string" && typeof value.units === "string" && typeof value.comment === "string" && isPosition(value.pos) && isSize(value.size);
}

function isConnector(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.kind === "connector" &&
    typeof value.id === "string" &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    (value.polarity === "+" || value.polarity === "-") &&
    (value.bend === null || isPosition(value.bend))
  );
}

function isComment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.kind === "comment" && typeof value.id === "string" && typeof value.text === "string" && isPosition(value.pos) && isSize(value.size);
}

function isSimSpec(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.startTime) &&
    isFiniteNumber(value.stopTime) &&
    isFiniteNumber(value.dt) &&
    (value.integrationMethod === "euler" || value.integrationMethod === "rk4") &&
    typeof value.timeUnits === "string"
  );
}

function isPosition(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isSize(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.width) && isFiniteNumber(value.height);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
