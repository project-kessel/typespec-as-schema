import { describe, it, expect } from "vitest";
import { camelToSnake } from "../../emitter/lib.js";

describe("camelToSnake", () => {
  it("converts PascalCase to snake_case", () => {
    expect(camelToSnake("RoleBinding")).toBe("role_binding");
    expect(camelToSnake("Host")).toBe("host");
    expect(camelToSnake("HostData")).toBe("host_data");
    expect(camelToSnake("Principal")).toBe("principal");
    expect(camelToSnake("Workspace")).toBe("workspace");
  });

  it("converts camelCase to snake_case", () => {
    expect(camelToSnake("roleBinding")).toBe("role_binding");
    expect(camelToSnake("hostData")).toBe("host_data");
  });

  it("handles already-lowercase strings", () => {
    expect(camelToSnake("host")).toBe("host");
    expect(camelToSnake("workspace")).toBe("workspace");
  });

  it("handles consecutive uppercase letters", () => {
    expect(camelToSnake("V1BasedPermission")).toBe("v1_based_permission");
  });

  it("handles empty string", () => {
    expect(camelToSnake("")).toBe("");
  });

  it("handles single character", () => {
    expect(camelToSnake("A")).toBe("a");
    expect(camelToSnake("a")).toBe("a");
  });
});
