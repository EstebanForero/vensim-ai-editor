export type TokenType = "num" | "ident" | "op" | "lparen" | "rparen" | "lbracket" | "rbracket" | "comma" | "eof";
export interface Token {
  type: TokenType;
  text: string;
}

// Function names Vensim writes with a space in them. Squashed to a single identifier so the
// lexer sees one token; printer.ts restores the space on the way out.
const MULTI_WORD_FUNCTIONS = ["IF THEN ELSE", "WITH LOOKUP"];

function normalizeMultiWordFunctions(src: string): string {
  let out = src;
  for (const name of MULTI_WORD_FUNCTIONS) {
    const squashed = name.replace(/ /g, "_");
    out = out.replace(new RegExp(name.replace(/ /g, "\\s+"), "gi"), squashed);
  }
  return out;
}

/** Quotes bare (unquoted) occurrences of multi-word variable names so the lexer treats them
 * as single identifiers, e.g. "Population * Growth Rate" with knownNames=["Growth Rate"]
 * becomes "Population * \"Growth Rate\"". Longest names are substituted first to avoid
 * partial-prefix collisions between names that share words. */
function quoteKnownMultiWordNames(src: string, knownNames: string[]): string {
  const multiWord = [...knownNames].filter((n) => /\s/.test(n)).sort((a, b) => b.length - a.length);
  let out = src;
  for (const name of multiWord) {
    const pattern = new RegExp(`(?<!["\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!["\\w])`, "g");
    out = out.replace(pattern, `"${name}"`);
  }
  return out;
}

export function tokenize(src: string, knownNames: string[] = []): Token[] {
  const s = normalizeMultiWordFunctions(quoteKnownMultiWordNames(src, knownNames));
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", text: c });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", text: c });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma", text: c });
      i++;
      continue;
    }
    // Square brackets appear only in a lookup table's `[(xmin,ymin)-(xmax,ymax)]` axis range —
    // nothing else in this expression subset uses them.
    if (c === "[") {
      tokens.push({ type: "lbracket", text: c });
      i++;
      continue;
    }
    if (c === "]") {
      tokens.push({ type: "rbracket", text: c });
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = "";
      while (j < s.length && s[j] !== '"') {
        text += s[j];
        j++;
      }
      tokens.push({ type: "ident", text });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.eE+-]/.test(s[j]!)) {
        // guard exponent sign only right after e/E
        if ((s[j] === "+" || s[j] === "-") && !/[eE]/.test(s[j - 1] ?? "")) break;
        j++;
      }
      tokens.push({ type: "num", text: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_.]/.test(s[j]!)) j++;
      tokens.push({ type: "ident", text: s.slice(i, j) });
      i = j;
      continue;
    }
    if (">=<>=".includes(c) || "<>=".includes(c)) {
      // handle <=, >=, <>
      const two = s.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "<>") {
        tokens.push({ type: "op", text: two });
        i += 2;
        continue;
      }
      tokens.push({ type: "op", text: c });
      i++;
      continue;
    }
    if ("+-*/^=".includes(c)) {
      tokens.push({ type: "op", text: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in expression: ${src}`);
  }
  tokens.push({ type: "eof", text: "" });
  return tokens;
}
