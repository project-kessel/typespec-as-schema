// HBI (Host Based Inventory) Service Schema
// Defines the host resource type with data fields, validation rules,
// and permissions derived from RBAC workspace permission extensions.

import "../../lib/main.tsp";
import "../rbac/rbac-extensions.tsp";

using Kessel;
using RBAC;

namespace Inventory;

/** UUID string format */
@format("uuid")
scalar UuidString extends string;

/** 10-digit numeric satellite ID format */
@pattern("^\\d{10}$")
scalar SatelliteNumericId extends string;

// ─── Host Resource Type ──────────────────────────────────────────────
// Relations, data fields, and permissions are all defined at the same
// level. The emitter extracts data fields for JSON Schema and filters
// out Kessel types automatically.

@v1Permission("read", "hosts", "inventory", "inventory_host_view")
@v1Permission("write", "hosts", "inventory", "inventory_host_update")
@cascadeDelete("workspace")
@resourceAnnotation("feature_flag", "staleness_v2")
@resourceAnnotation("retention_days", "90")
model Host {
  /** Every host belongs to exactly one RBAC workspace */
  workspace: WorkspaceRef;

  /** UUID of the subscription manager */
  @format("uuid")
  subscription_manager_id?: string;

  /** Can be UUID or 10-digit numeric string */
  satellite_id?: UuidString | SatelliteNumericId;

  /** UUID of the insights registration */
  @format("uuid")
  insights_id?: string;

  /** Ansible hostname, max 255 characters */
  @maxLength(255)
  ansible_host?: string;
}
