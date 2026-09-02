import { allVariables, type Model } from "./types.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  elementId?: string;
}

/** Basic referential-integrity checks. Does not attempt full unit analysis. */
export function validateModel(model: Model): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set(allVariables(model).map((v) => v.id));

  for (const flow of model.flows) {
    if (flow.from && !ids.has(flow.from)) {
      issues.push({ severity: "error", message: `Flow "${flow.name}" references missing stock (from).`, elementId: flow.id });
    }
    if (flow.to && !ids.has(flow.to)) {
      issues.push({ severity: "error", message: `Flow "${flow.name}" references missing stock (to).`, elementId: flow.id });
    }
    if (!flow.from && !flow.to) {
      issues.push({ severity: "warning", message: `Flow "${flow.name}" is not connected to any stock.`, elementId: flow.id });
    }
  }

  for (const stock of model.stocks) {
    for (const fid of [...stock.inflows, ...stock.outflows]) {
      if (!model.flows.some((f) => f.id === fid)) {
        issues.push({ severity: "error", message: `Stock "${stock.name}" references missing flow ${fid}.`, elementId: stock.id });
      }
    }
  }

  for (const c of model.connectors) {
    if (!ids.has(c.from)) issues.push({ severity: "error", message: `Connector references missing source ${c.from}.`, elementId: c.id });
    if (!ids.has(c.to)) issues.push({ severity: "error", message: `Connector references missing target ${c.to}.`, elementId: c.id });
  }

  const names = new Map<string, number>();
  for (const v of allVariables(model)) {
    const lower = v.name.toLowerCase();
    names.set(lower, (names.get(lower) ?? 0) + 1);
  }
  for (const [name, count] of names) {
    if (count > 1) issues.push({ severity: "error", message: `Duplicate variable name "${name}" (${count} occurrences).` });
  }

  return issues;
}
