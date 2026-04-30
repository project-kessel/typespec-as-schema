import { describe, it, expect } from "vitest";
import { getNamespaceFQN } from "../../src/lib.js";

function fakeNs(name: string, parent?: ReturnType<typeof fakeNs>): any {
  return { name, namespace: parent };
}

describe("getNamespaceFQN", () => {
  it("returns empty string for undefined", () => {
    expect(getNamespaceFQN(undefined)).toBe("");
  });

  it("returns the name for a single-level namespace", () => {
    expect(getNamespaceFQN(fakeNs("Inventory"))).toBe("Inventory");
  });

  it("joins nested namespaces with dots", () => {
    const root = fakeNs("Root");
    const child = fakeNs("Child", root);
    expect(getNamespaceFQN(child)).toBe("Root.Child");
  });

  it("handles three levels of nesting", () => {
    const a = fakeNs("A");
    const b = fakeNs("B", a);
    const c = fakeNs("C", b);
    expect(getNamespaceFQN(c)).toBe("A.B.C");
  });

  it("stops at a namespace with empty name (global ns sentinel)", () => {
    const global = fakeNs("");
    const child = fakeNs("Kessel", global);
    expect(getNamespaceFQN(child)).toBe("Kessel");
  });
});
