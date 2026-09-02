/** Splits `str` on top-level commas, respecting parenthesis nesting and quoted strings. */
export function splitTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let current = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i]!;
    if (c === '"') inQuotes = !inQuotes;
    if (!inQuotes) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += c;
  }
  parts.push(current);
  return parts.map((p) => p.trim());
}
