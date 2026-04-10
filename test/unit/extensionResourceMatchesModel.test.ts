import { describe, it, expect } from "vitest";
import { extensionResourceMatchesModel } from "../../src/lib.js";

describe("extensionResourceMatchesModel", () => {
  it("matches host model to hosts slug (ResourceDef uses camelToSnake names)", () => {
    expect(extensionResourceMatchesModel("host", "hosts")).toBe(true);
  });

  it("does not match unrelated slug", () => {
    expect(extensionResourceMatchesModel("host", "policies")).toBe(false);
  });

  it("matches remediation to remediations slug", () => {
    expect(extensionResourceMatchesModel("remediation", "remediations")).toBe(true);
    expect(extensionResourceMatchesModel("remediations", "remediations")).toBe(true);
  });

  it("allows any model when slug omitted", () => {
    expect(extensionResourceMatchesModel("host", undefined)).toBe(true);
    expect(extensionResourceMatchesModel("host", "")).toBe(true);
  });
});
