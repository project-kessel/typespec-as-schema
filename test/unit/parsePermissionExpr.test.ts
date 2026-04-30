import { describe, it, expect } from "vitest";
import { parsePermissionExpr, slotName } from "../../src/lib.js";

describe("parsePermissionExpr", () => {
  it("returns null for empty string", () => {
    expect(parsePermissionExpr("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parsePermissionExpr("   ")).toBeNull();
    expect(parsePermissionExpr("\t")).toBeNull();
  });

  it("parses a simple reference", () => {
    expect(parsePermissionExpr(slotName("workspace"))).toEqual({
      kind: "ref",
      name: slotName("workspace"),
    });
  });

  it("parses a dot-separated sub-reference with t_ prefix", () => {
    expect(parsePermissionExpr("workspace.inventory_host_view")).toEqual({
      kind: "subref",
      name: slotName("workspace"),
      subname: "inventory_host_view",
    });
  });

  it("parses union with + separator", () => {
    const result = parsePermissionExpr("binding->inventory_host_view + parent->inventory_host_view");
    expect(result).toEqual({
      kind: "or",
      members: [
        { kind: "subref", name: slotName("binding"), subname: "inventory_host_view" },
        { kind: "subref", name: slotName("parent"), subname: "inventory_host_view" },
      ],
    });
  });

  it("parses union with | separator", () => {
    const result = parsePermissionExpr("a | b | c");
    expect(result).toEqual({
      kind: "or",
      members: [
        { kind: "ref", name: "a" },
        { kind: "ref", name: "b" },
        { kind: "ref", name: "c" },
      ],
    });
  });

  it("parses intersection with & separator", () => {
    const result = parsePermissionExpr("subject & granted->inventory_host_view");
    expect(result).toEqual({
      kind: "and",
      members: [
        { kind: "ref", name: "subject" },
        { kind: "subref", name: slotName("granted"), subname: "inventory_host_view" },
      ],
    });
  });

  it("parses a bare name as ref", () => {
    expect(parsePermissionExpr("any_any_any")).toEqual({
      kind: "ref",
      name: "any_any_any",
    });
  });

  it("parses parenthesized expression", () => {
    const result = parsePermissionExpr("(a & b)");
    expect(result).toEqual({
      kind: "and",
      members: [
        { kind: "ref", name: "a" },
        { kind: "ref", name: "b" },
      ],
    });
  });

  it("handles mixed union and arrow operators", () => {
    const result = parsePermissionExpr("a + b->c + d");
    expect(result).toEqual({
      kind: "or",
      members: [
        { kind: "ref", name: "a" },
        { kind: "subref", name: slotName("b"), subname: "c" },
        { kind: "ref", name: "d" },
      ],
    });
  });
});

describe("parsePermissionExpr: malformed inputs", () => {
  it("throws on unexpected characters", () => {
    expect(() => parsePermissionExpr("a ! b")).toThrow(/Unexpected character/);
    expect(() => parsePermissionExpr("a @ b")).toThrow(/Unexpected character/);
    expect(() => parsePermissionExpr("123")).toThrow(/Unexpected character/);
  });

  it("throws on trailing operator with no operand", () => {
    expect(() => parsePermissionExpr("a +")).toThrow();
  });

  it("throws on leading operator with no left operand", () => {
    expect(() => parsePermissionExpr("+ a")).toThrow();
  });

  it("throws on arrow with no right-hand identifier", () => {
    expect(() => parsePermissionExpr("a->")).toThrow();
  });

  it("throws on unclosed parenthesis", () => {
    expect(() => parsePermissionExpr("(a & b")).toThrow();
  });

  it("throws on double operators", () => {
    expect(() => parsePermissionExpr("a + + b")).toThrow();
  });

  it("throws on empty parentheses", () => {
    expect(() => parsePermissionExpr("()")).toThrow();
  });
});
