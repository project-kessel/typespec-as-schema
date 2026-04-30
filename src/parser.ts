// Recursive-descent parser for SpiceDB permission expressions.
//
// Grammar:
//   expr      = andExpr ( ("+" | "|") andExpr )*
//   andExpr   = primary ( "&" primary )*
//   primary   = "(" expr ")" | ref
//   ref       = IDENT ( "->" IDENT | "." IDENT )?
//   IDENT     = [a-zA-Z_][a-zA-Z0-9_]*

import type { RelationBody } from "./types.js";

type Token =
  | { type: "ident"; value: string }
  | { type: "arrow" }
  | { type: "dot" }
  | { type: "plus" }
  | { type: "pipe" }
  | { type: "amp" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "eof" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] === " " || input[i] === "\t") {
      i++;
      continue;
    }
    if (input[i] === "-" && input[i + 1] === ">") {
      tokens.push({ type: "arrow" });
      i += 2;
      continue;
    }
    if (input[i] === ".") { tokens.push({ type: "dot" }); i++; continue; }
    if (input[i] === "+") { tokens.push({ type: "plus" }); i++; continue; }
    if (input[i] === "|") { tokens.push({ type: "pipe" }); i++; continue; }
    if (input[i] === "&") { tokens.push({ type: "amp" }); i++; continue; }
    if (input[i] === "(") { tokens.push({ type: "lparen" }); i++; continue; }
    if (input[i] === ")") { tokens.push({ type: "rparen" }); i++; continue; }

    if (/[a-zA-Z_]/.test(input[i])) {
      let start = i;
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) i++;
      tokens.push({ type: "ident", value: input.slice(start, i) });
      continue;
    }

    throw new Error(`Unexpected character '${input[i]}' at position ${i} in expression: ${input}`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: Token["type"]): Token {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new Error(`Expected ${type}, got ${tok.type}`);
    }
    return this.advance();
  }

  parse(): RelationBody {
    const result = this.parseExpr();
    this.expect("eof");
    return result;
  }

  private parseExpr(): RelationBody {
    let left = this.parseAndExpr();
    while (this.peek().type === "plus" || this.peek().type === "pipe") {
      this.advance();
      const right = this.parseAndExpr();
      left = mergeOr(left, right);
    }
    return left;
  }

  private parseAndExpr(): RelationBody {
    let left = this.parsePrimary();
    while (this.peek().type === "amp") {
      this.advance();
      const right = this.parsePrimary();
      left = mergeAnd(left, right);
    }
    return left;
  }

  private parsePrimary(): RelationBody {
    if (this.peek().type === "lparen") {
      this.advance();
      const inner = this.parseExpr();
      this.expect("rparen");
      return inner;
    }
    return this.parseRef();
  }

  private parseRef(): RelationBody {
    const identTok = this.expect("ident");
    const name = (identTok as { type: "ident"; value: string }).value;

    if (this.peek().type === "arrow") {
      this.advance();
      const subTok = this.expect("ident");
      const subname = (subTok as { type: "ident"; value: string }).value;
      return { kind: "subref", name: `t_${name}`, subname };
    }

    if (this.peek().type === "dot") {
      this.advance();
      const subTok = this.expect("ident");
      const subname = (subTok as { type: "ident"; value: string }).value;
      return { kind: "subref", name: `t_${name}`, subname };
    }

    return { kind: "ref", name };
  }
}

function mergeOr(left: RelationBody, right: RelationBody): RelationBody {
  const leftMembers = left.kind === "or" ? left.members : [left];
  const rightMembers = right.kind === "or" ? right.members : [right];
  return { kind: "or", members: [...leftMembers, ...rightMembers] };
}

function mergeAnd(left: RelationBody, right: RelationBody): RelationBody {
  const leftMembers = left.kind === "and" ? left.members : [left];
  const rightMembers = right.kind === "and" ? right.members : [right];
  return { kind: "and", members: [...leftMembers, ...rightMembers] };
}

/**
 * Parses a SpiceDB permission expression string into a RelationBody AST.
 * Supports union (+, |), intersection (&), arrow (->), dot (.), and parenthesized groups.
 */
export function parsePermissionExpr(expr: string): RelationBody | null {
  if (!expr || !expr.trim()) return null;
  const tokens = tokenize(expr.trim());
  const parser = new Parser(tokens);
  return parser.parse();
}
