// M8 AI Accuracy Test: TypeSpec
// Task: Add a policy resource type with workspace relation, data fields, and view permission

import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "./rbac.tsp";

using JsonSchema;
using Kessel;

namespace Inventory;

// Extension application
alias policyViewPermission = RBAC.V1BasedPermission<
  "inventory",
  "policies",
  "read",
  "inventory_policy_view"
>;

// Data schema for JSONSchema output
@jsonSchema
model PolicyData {
  @maxLength(100)
  name: string;

  @maxLength(500)
  description?: string;

  policy_type?: "access" | "compliance" | "security";

  @format("uuid")
  external_id?: string;
}

// Resource type
model Policy {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  data: PolicyData;
  view: Permission<"workspace.inventory_policy_view">;
}
