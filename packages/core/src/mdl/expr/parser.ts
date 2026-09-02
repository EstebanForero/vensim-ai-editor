import type { Expr } from "./ast.js";
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

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "num") {
      this.next();
      return { type: "num", value: Number(t.text) };
    }
    if (t.type === "lparen") {
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
