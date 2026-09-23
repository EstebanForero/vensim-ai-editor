import { normalizeLookupTable, type Expr, type LookupPoint, type LookupTable } from "./ast.js";
import { tokenize, type Token, type TokenType } from "./lexer.js";

// Pratt parser over the token stream, precedence lowest-to-highest:
// OR -> AND -> NOT -> comparison -> additive -> multiplicative -> power -> unary -> primary.
class Parser {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(type: TokenType): Token {
    const t = this.next();
    if (t.type !== type) throw new Error(`Expected ${type} but got "${t.text}"`);
    return t;
  }

  parseExpr(): Expr {
    const e = this.parseOr();
    this.expect("eof");
    return e;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.peek().type === "ident" && this.peek().text.toUpperCase() === "OR") {
      this.next();
      const right = this.parseAnd();
      left = { type: "binary", op: "OR", left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.peek().type === "ident" && this.peek().text.toUpperCase() === "AND") {
      this.next();
      const right = this.parseNot();
      left = { type: "binary", op: "AND", left, right };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.peek().type === "ident" && this.peek().text.toUpperCase() === "NOT") {
      this.next();
      return { type: "unary", op: "NOT", arg: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (this.peek().type === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(this.peek().text)) {
      const op = this.next().text;
      const right = this.parseAdditive();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.peek().type === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.next().text;
      const right = this.parseMultiplicative();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parsePower();
    while (this.peek().type === "op" && (this.peek().text === "*" || this.peek().text === "/")) {
      const op = this.next().text;
      const right = this.parsePower();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parsePower(): Expr {
    const base = this.parseUnary();
    if (this.peek().type === "op" && this.peek().text === "^") {
      this.next();
      const exp = this.parsePower();
      return { type: "binary", op: "^", left: base, right: exp };
    }
    return base;
  }

  private parseUnary(): Expr {
    if (this.peek().type === "op" && (this.peek().text === "-" || this.peek().text === "+")) {
      const op = this.next().text as "-" | "+";
      return { type: "unary", op, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  /** One signed number inside a lookup's point list — Vensim writes these as bare literals
   * (`(0,0)`, `(-10,0.5)`), so unlike a general sub-expression there's no further parsing. */
  private parseLookupNumber(): number {
    let sign = 1;
    if (this.peek().type === "op" && (this.peek().text === "-" || this.peek().text === "+")) {
      if (this.next().text === "-") sign = -1;
    }
    const t = this.next();
    if (t.type !== "num") throw new Error(`Expected a number in lookup point but got "${t.text}"`);
    return sign * Number(t.text);
  }

  private parseLookupPoint(): LookupPoint {
    this.expect("lparen");
    const x = this.parseLookupNumber();
    this.expect("comma");
    const y = this.parseLookupNumber();
    this.expect("rparen");
    return { x, y };
  }

  /** Parses a lookup-table literal, starting at (and consuming) its opening `(`:
   * `([(xmin,ymin)-(xmax,ymax)],(x1,y1),(x2,y2),...)` — with the bracketed axis range optional
   * (`((0,0),(10,1))`), and with a range-only form (`([(0,0)-(10,1)])`) meaning the straight line
   * between those two corners, which is what Vensim itself draws for a lookup with no points
   * placed yet. */
  private parseLookup(): Expr {
    this.expect("lparen");

    let range: { xMin: number; yMin: number; xMax: number; yMax: number } | null = null;
    if (this.peek().type === "lbracket") {
      this.next();
      const min = this.parseLookupPoint();
      if (!(this.peek().type === "op" && this.peek().text === "-")) {
        throw new Error(`Expected "-" between the two corners of a lookup's axis range`);
      }
      this.next();
      const max = this.parseLookupPoint();
      this.expect("rbracket");
      range = { xMin: min.x, yMin: min.y, xMax: max.x, yMax: max.y };
      if (this.peek().type === "comma") this.next();
    }

    const points: LookupPoint[] = [];
    while (this.peek().type === "lparen") {
      points.push(this.parseLookupPoint());
      if (this.peek().type === "comma") this.next();
    }
    this.expect("rparen");

    if (points.length === 0) {
      if (!range) throw new Error("A lookup table needs either an axis range or at least one point");
      // Range-only: the box's two corners are the curve's endpoints.
      points.push({ x: range.xMin, y: range.yMin }, { x: range.xMax, y: range.yMax });
    }
    if (!range) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      range = { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) };
    }

    return { type: "lookup", table: normalizeLookupTable({ points, ...range }) };
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "num") {
      this.next();
      return { type: "num", value: Number(t.text) };
    }
    if (t.type === "lparen") {
      // A leading `(` could open a lookup table or an ordinary grouping. The grammar is only
      // ambiguous on the first token, so try the lookup form speculatively and rewind on
      // failure — a grouping paren can never start with `[` or with `(<number>,`.
      const saved = this.pos;
      try {
        return this.parseLookup();
      } catch {
        this.pos = saved;
      }
      this.next();
      const e = this.parseOr();
      this.expect("rparen");
      return e;
    }
    if (t.type === "ident") {
      this.next();
      if (this.peek().type === "lparen") {
        this.next();
        const args: Expr[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseOr());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseOr());
          }
        }
        this.expect("rparen");
        return { type: "call", name: t.text, args };
      }
      return { type: "var", name: t.text };
    }
    throw new Error(`Unexpected token "${t.text}" in expression`);
  }
}

/** `knownNames` lets unquoted multi-word variable references (e.g. `Growth Rate`) be
 * recognized as single identifiers, matching Vensim's own equation syntax. */
export function parseExpr(src: string, knownNames: string[] = []): Expr {
  return new Parser(tokenize(src, knownNames)).parseExpr();
}

/** Best-effort parse: returns null instead of throwing (equation kept as opaque raw text). */
export function tryParseExpr(src: string, knownNames: string[] = []): Expr | null {
  try {
    return parseExpr(src, knownNames);
  } catch {
    return null;
  }
}
