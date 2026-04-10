import { describe, it, expect } from "vitest";
import { bodyToZed } from "../../src/lib.js";

describe("bodyToZed", () => {
  it("renders assignable as target name", () => {
    expect(bodyToZed({ kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" }))
      .toBe("rbac/workspace");
  });

  it("renders bool with wildcard syntax", () => {
    expect(bodyToZed({ kind: "bool", target: "rbac/principal" }))
      .toBe("rbac/principal:*");
  });

  it("renders ref as plain name", () => {
    expect(bodyToZed({ kind: "ref", name: "t_workspace" }))
      .toBe("t_workspace");
  });

  it("renders subref with arrow syntax", () => {
    expect(bodyToZed({ kind: "subref", name: "t_binding", subname: "inventory_host_view" }))
      .toBe("t_binding->inventory_host_view");
  });

  it("renders or as + joined members", () => {
    const body = {
      kind: "or" as const,
      members: [
        { kind: "subref" as const, name: "t_binding", subname: "x" },
        { kind: "subref" as const, name: "t_parent", subname: "x" },
      ],
    };
    expect(bodyToZed(body)).toBe("t_binding->x + t_parent->x");
  });

  it("renders and wrapped in parentheses", () => {
    const body = {
      kind: "and" as const,
      members: [
        { kind: "ref" as const, name: "subject" },
        { kind: "subref" as const, name: "t_granted", subname: "perm" },
      ],
    };
    expect(bodyToZed(body)).toBe("(subject & t_granted->perm)");
  });

  it("renders complex nested or with refs and subrefs", () => {
    const body = {
      kind: "or" as const,
      members: [
        { kind: "ref" as const, name: "any_any_any" },
        { kind: "ref" as const, name: "inventory_any_any" },
        { kind: "ref" as const, name: "inventory_hosts_read" },
      ],
    };
    expect(bodyToZed(body)).toBe("any_any_any + inventory_any_any + inventory_hosts_read");
  });
});
