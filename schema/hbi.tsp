// HBI (Host Based Inventory) Service Schema
// Defines the host resource type with data fields, validation rules,
// and permissions derived from RBAC workspace permission extensions.

import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "../lib/decorators.tsp";
import "./rbac/rbac.tsp";

using JsonSchema;
using Kessel;

namespace Inventory;

// ─── Host Data Schema (→ JSONSchema) ─────────────────────────────────

/** 10-digit numeric satellite ID format */
@pattern("^\\d{10}$")
scalar SatelliteNumericId extends string;

/** Data fields for a host resource, with validation rules */
@jsonSchema
model HostData {
  /** UUID of the subscription manager */
  @format("uuid")
  subscription_manager_id?: string;

  /** Can be UUID or 10-digit numeric string */
  satellite_id?: string | SatelliteNumericId;

  /** UUID of the insights registration */
  @format("uuid")
  insights_id?: string;

  /** Ansible hostname, max 255 characters */
  @maxLength(255)
  ansible_host?: string;
}

// ─── Host Resource Type ──────────────────────────────────────────────

@v1Permission("inventory", "hosts", "read", "inventory_host_view")
@v1Permission("inventory", "hosts", "write", "inventory_host_update")
@cascadeDelete("workspace")
@resourceAnnotation("feature_flag", "staleness_v2")
@resourceAnnotation("retention_days", "90")
model Host {
  /** Every host belongs to exactly one RBAC workspace */
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;

  /** Host data fields with validation */
  data: HostData;

  /** View permission: resolves to workspace->inventory_host_view */
  view: WorkspacePermission<"inventory_host_view">;

  /** Update permission: resolves to workspace->inventory_host_update */
  update: WorkspacePermission<"inventory_host_update">;
}
