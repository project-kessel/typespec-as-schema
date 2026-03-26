import { describe, it, expect } from "vitest";
import { parsePermissionExpr } from "../../emitter/lib.js";

describe("parsePermissionExpr", () => {
  it("returns null for empty string", () => {
    expect(parsePermissionExpr("")).toBeNull();
  });

  it("parses a simple reference", () => {
    expect(parsePermissionExpr("t_workspace")).toEqual({
      kind: "ref",
      name: "t_workspace",
    });
  });

  it("parses a dot-separated sub-reference with t_ prefix", () => {
    expect(parsePermissionExpr("workspace.inventory_host_view")).toEqual({
      kind: "subref",
      name: "t_workspace",
      subname: "inventory_host_view",
    });
  });

  it("parses union with + separator", () => {
    const result = parsePermissionExpr("binding->inventory_host_view + parent->inventory_host_view");
    expect(result).toEqual({
      kind: "or",
      members: [
        { kind: "subref", name: "t_binding", subname: "inventory_host_view" },
        { kind: "subref", name: "t_parent", subname: "inventory_host_view" },
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
        { kind: "subref", name: "t_granted", subname: "inventory_host_view" },
      ],
    });
  });

  it("parses a bare name as ref", () => {
    expect(parsePermissionExpr("any_any_any")).toEqual({
      kind: "ref",
      name: "any_any_any",
    });
  });
});
