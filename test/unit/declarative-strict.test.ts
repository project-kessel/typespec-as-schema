import { describe, it, expect } from "vitest";
import {
  applyDeclaredPatches,
  ExtensionPatchError,
} from "../../src/declarative-extensions.js";
import type { ResourceDef } from "../../src/lib.js";

describe("applyDeclaredPatches strict mode", () => {
  const minimalRbac: ResourceDef[] = [
    { name: "role", namespace: "rbac", relations: [] },
    { name: "role_binding", namespace: "rbac", relations: [] },
    { name: "workspace", namespace: "rbac", relations: [] },
  ];

  it("throws ExtensionPatchError on unparseable permission rule when strict", () => {
    expect(() =>
      applyDeclaredPatches(
        minimalRbac,
        [
          {
            params: {
              application: "inv",
              resource: "hosts",
              verb: "read",
              v2Perm: "inv_view",
            },
            patchRules: [
              {
                target: "role",
                patchType: "permission",
                rawValue: "this_is_not_a_permission_rule",
              },
            ],
          },
        ],
        { strict: true },
      ),
    ).toThrow(ExtensionPatchError);
  });

  it("skips unparseable permission rule when strict is false", () => {
    expect(() =>
      applyDeclaredPatches(
        minimalRbac,
        [
          {
            params: {
              application: "inv",
              resource: "hosts",
              verb: "read",
              v2Perm: "inv_view",
            },
            patchRules: [
              {
                target: "role",
                patchType: "permission",
                rawValue: "this_is_not_a_permission_rule",
              },
            ],
          },
        ],
        { strict: false },
      ),
    ).not.toThrow();
  });
});
