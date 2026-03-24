// Remediations Service Schema
// Defines the remediation resource type with data fields, validation rules,
// and permissions derived from RBAC workspace permission extensions.

import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "./rbac.tsp";

using JsonSchema;
using Kessel;

namespace Remediations;

// ─── Extension Applications ──────────────────────────────────────────

/** Maps remediations:remediation:read → remediations_remediation_view on workspace */
alias remediationViewPermission = RBAC.V1BasedPermission<
  "remediations",
  "remediation",
  "read",
  "remediations_remediation_view"
>;

/** Maps remediations:remediation:write → remediations_remediation_update on workspace */
alias remediationUpdatePermission = RBAC.V1BasedPermission<
  "remediations",
  "remediation",
  "write",
  "remediations_remediation_update"
>;

// ─── Remediation Data Schema (→ JSONSchema) ──────────────────────────

@jsonSchema
model RemediationData {
  @maxLength(200)
  name: string;

  @maxLength(1000)
  description?: string;

  remediation_type?: string;

  @format("uuid")
  external_id?: string;
}

// ─── Remediation Resource Type ───────────────────────────────────────

model Remediation {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  data: RemediationData;
  view: Permission<"workspace.remediations_remediation_view">;
  update: Permission<"workspace.remediations_remediation_update">;
}
