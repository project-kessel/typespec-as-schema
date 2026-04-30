import { describe, it, expect } from "vitest";
import { bodyToZed, slotName } from "../../src/lib.js";

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
    expect(bodyToZed({ kind: "ref", name: slotName("workspace") }))
      .toBe(`${slotName("workspace")}`);
  });

  it("renders subref with arrow syntax", () => {
    expect(bodyToZed({ kind: "subref", name: slotName("binding"), subname: "inventory_host_view" }))
      .toBe(`${slotName("binding")}->inventory_host_view`);
  });

  it("renders or as + joined members", () => {
    const body = {
      kind: "or" as const,
      members: [
        { kind: "subref" as const, name: slotName("binding"), subname: "x" },
        { kind: "subref" as const, name: slotName("parent"), subname: "x" },
      ],
    };
    expect(bodyToZed(body)).toBe(`${slotName("binding")}->x + ${slotName("parent")}->x`);
  });

  it("renders and wrapped in parentheses", () => {
    const body = {
      kind: "and" as const,
      members: [
        { kind: "ref" as const, name: "subject" },
        { kind: "subref" as const, name: slotName("granted"), subname: "perm" },
      ],
    };
    expect(bodyToZed(body)).toBe(`(subject & ${slotName("granted")}->perm)`);
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
