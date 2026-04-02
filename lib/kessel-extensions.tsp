// Kessel Extension Library
// Declarative extension templates for Zanzibar-style authorization patterns.
// The RBAC team defines the patch rules here as structured string properties.
// The generic emitter reads these rules and applies patches to the model
// without any extension-specific code.
//
// Patch-rule property naming convention:
//   {target}_{patchType}
//
//   target:    role | roleBinding | workspace
//   patchType: boolRelations | permission | viewMetadataAccumulator
//
// Patch-rule syntax:
//   boolRelations:          comma-separated names to add as BoolRelation<Principal>
//   permission:             name=body  where body uses | for union, & for intersect, -> for subreference
//   viewMetadataAccumulator: "read"  (verb that triggers view_metadata accumulation)
//
// Placeholders: {app}, {res}, {verb}, {v2} are interpolated from the template params.

import "./kessel.tsp";

namespace Kessel;

model V1WorkspacePermission<
  App extends string,
  Res extends string,
  Verb extends string,
  V2 extends string
> {
  application: App;
  resource: Res;
  verb: Verb;
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

  // Which verb triggers view_metadata accumulation
  workspace_viewMetadataAccumulator: "read";
}
