// HBI Schema — Augment-Based Extension Approach
// Uses TypeSpec's `augment` to add permission-related properties
// to RBAC types, modeling the cooperative extension pattern.

import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "./rbac-augment.tsp";

using JsonSchema;
using Kessel;

namespace InventoryAugment;

// ─── Augment RBAC types with inventory permissions ───────────────────
// This is how TypeSpec natively supports cross-namespace extension.

// Add V1 wildcard permissions and V2 computed permission to Role
@@doc(RBACAugment.Role, "Extended with inventory permissions");

// Add V2 computed permission to RoleBinding
// Note: TypeSpec `augment` can add decorators but not new properties
// to existing models. For adding properties, we use model `is` inheritance.

// ─── Extended RBAC Types ─────────────────────────────────────────────
// Since TypeSpec augment can add decorators but not properties,
// extensions that add new relations need to use model composition.

/** Role extended with inventory permissions */
model ExtendedRole is RBACAugment.Role {
  // V1 wildcard permissions
  inventory_all_all: BoolRelation<RBACAugment.Principal>;
  inventory_hosts_all: BoolRelation<RBACAugment.Principal>;
  inventory_all_read: BoolRelation<RBACAugment.Principal>;
  inventory_hosts_read: BoolRelation<RBACAugment.Principal>;
  inventory_all_write: BoolRelation<RBACAugment.Principal>;
  inventory_hosts_write: BoolRelation<RBACAugment.Principal>;

  // V2 aggregate permissions
  inventory_host_view: Permission<"all_all_all | inventory_all_all | inventory_hosts_all | inventory_all_read | inventory_hosts_read">;
  inventory_host_update: Permission<"all_all_all | inventory_all_all | inventory_hosts_all | inventory_all_write | inventory_hosts_write">;
}

/** RoleBinding extended with inventory permissions */
model ExtendedRoleBinding is RBACAugment.RoleBinding {
  inventory_host_view: Permission<"subject & granted->inventory_host_view">;
  inventory_host_update: Permission<"subject & granted->inventory_host_update">;
}

/** Workspace extended with inventory permissions */
model ExtendedWorkspace is RBACAugment.Workspace {
  inventory_host_view: Permission<"user_grant->inventory_host_view | parent->inventory_host_view">;
  inventory_host_update: Permission<"user_grant->inventory_host_update | parent->inventory_host_update">;
}

// ─── Host Data Schema (→ JSONSchema) ─────────────────────────────────

@pattern("^\\d{10}$")
scalar SatelliteNumericId extends string;

@jsonSchema
model HostData {
  @format("uuid")
  subscription_manager_id?: string;

  satellite_id?: string | SatelliteNumericId;

  @format("uuid")
  insights_id?: string;

  @maxLength(255)
  ansible_host?: string;
}

// ─── Host Resource ───────────────────────────────────────────────────

model Host {
  workspace: Assignable<RBACAugment.Workspace, Cardinality.ExactlyOne>;
  data: HostData;
  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;
}
