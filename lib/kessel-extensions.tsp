// Kessel Extension Library
// Declarative extension templates for Zanzibar-style authorization patterns.
// The RBAC team defines the patch rules here as structured string properties.
// The generic emitter reads these rules and applies patches to the model
// without any extension-specific code.
//
// Keep in sync: `V1WorkspacePermission` patch properties are mirrored for tests
// in `src/declarative-extensions.ts` as `V1_WORKSPACE_PERMISSION_TEMPLATE_RULES`.
// CI: `test/unit/template-rules-drift.test.ts` compares this template to that array.
//
// Patch-rule property naming convention:
//   {target}_{patchType}
//
//   target:    role | roleBinding | workspace | jsonSchema
//   patchType: boolRelations | permission | public | accumulate | addField
//
// Patch-rule syntax:
//   boolRelations:  comma-separated names to add as BoolRelation<Principal>
//   permission:     name=body  (body uses | for union, & for intersect, -> for subreference)
//   public:         comma-separated permission names to mark as public
//   accumulate:     name=op(ref),when=condition,public=bool
//                   Collects refs across all extension instances, merges with op.
//                   "when" gates on a param equality check ({param}==value).
//   addField:       name=type:format,required=bool
//                   Adds a field to JSON Schema output for the extension's service.
//
// Placeholders: {app}, {res}, {verb}, {v2} are interpolated from the template params.

import "./kessel.tsp";

namespace Kessel;

/** Allowed verbs for permission registration. */
alias KesselVerb = "read" | "write" | "create" | "delete";

model V1WorkspacePermission<
  App extends string,
  Res extends string,
  Verb extends KesselVerb,
  V2 extends string
> {
  /** Lowercase application identifier (e.g. "inventory"). */
  application: App;

  /** Lowercase resource identifier (e.g. "hosts"). */
  resource: Res;

  /** The verb this permission covers. */
  verb: Verb;

  /** Snake_case v2 permission name (e.g. "inventory_host_view"). */
  v2Perm: V2;

  // On rbac/role: add bool relations for the permission hierarchy
  role_boolRelations: "{app}_any_any,{app}_{res}_any,{app}_any_{verb},{app}_{res}_{verb}";

  // On rbac/role: add computed permission as union of bool hierarchy
  role_permission: "{v2}=any_any_any | {app}_any_any | {app}_{res}_any | {app}_any_{verb} | {app}_{res}_{verb}";

  // On rbac/role_binding: add intersect permission
  roleBinding_permission: "{v2}=subject & granted->{v2}";

  // On rbac/workspace: add union permission from bindings + parent
  workspace_permission: "{v2}=binding->{v2} | parent->{v2}";

  // Mark workspace permission as public
  workspace_public: "{v2}";

  // Accumulate read-verb permissions into workspace.view_metadata (OR)
  workspace_accumulate: "view_metadata=or({v2}),when={verb}==read,public=true";
}
