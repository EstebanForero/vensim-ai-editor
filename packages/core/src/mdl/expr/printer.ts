import type { Expr } from "./ast.js";

function needsQuotes(name: string): boolean {
  return /[^A-Za-z0-9_]/.test(name) || /^\d/.test(name);
}

export function exprToString(e: Expr): string {
  switch (e.type) {
    case "num":
      return String(e.value);
    case "var":
      return needsQuotes(e.name) ? `"${e.name}"` : e.name;
    case "unary":
      return e.op === "NOT" ? `NOT ${exprToString(e.arg)}` : `${e.op}${exprToString(e.arg)}`;
    case "binary":
      return `${exprToString(e.left)} ${e.op} ${exprToString(e.right)}`;
    case "call": {
      const name = e.name.toUpperCase() === "IF_THEN_ELSE" ? "IF THEN ELSE" : e.name;
      return `${name}(${e.args.map(exprToString).join(", ")})`;
    }
  }
}
