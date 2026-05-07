// HBI (Host Based Inventory) Service Schema
// Defines the host resource type with data fields, validation rules,
// and permissions derived from RBAC workspace permission extensions.

import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "./rbac/rbac-extensions.tsp";
import "./rbac/rbac.tsp";

using Kessel;

namespace Inventory;

// ─── Extension Applications ──────────────────────────────────────────
// V1WorkspacePermission is owned by the RBAC provider (./rbac/).
// Services import the RBAC extension template to register permissions.

/** Maps inventory:hosts:read → inventory_host_view on workspace */
alias viewPermission = Kessel.V1WorkspacePermission<
  "inventory",
  "hosts",
  "read",
  "inventory_host_view"
>;

/** Maps inventory:hosts:write → inventory_host_update on workspace */
alias updatePermission = Kessel.V1WorkspacePermission<
  "inventory",
  "hosts",
  "write",
  "inventory_host_update"
>;

// ─── Cascade Delete Policy ──────────────────────────────────────────
// When a workspace is deleted, hosts within it should be deletable.

alias hostCascadeDelete = Kessel.CascadeDeletePolicy<
  "inventory",
  "host",
  "workspace"
>;

// ─── Resource Annotations (→ IR metadata only) ─────────────────────
// These do not affect SpiceDB schema — they attach service-specific
// metadata to resources for consumption by downstream systems.

/** Feature flag governing staleness detection version */
alias hostStalenessFeature = Kessel.ResourceAnnotation<
  "inventory",
  "host",
  "feature_flag",
  "staleness_v2"
>;

/** Data retention policy in days */
alias hostRetention = Kessel.ResourceAnnotation<
  "inventory",
  "host",
  "retention_days",
  "90"
>;

/** UUID string format */
@format("uuid")
scalar UuidString extends string;

/** 10-digit numeric satellite ID format */
@pattern("^\\d{10}$")
scalar SatelliteNumericId extends string;

// ─── Host Resource Type ──────────────────────────────────────────────
// Relations (→ SpiceDB), data fields (→ JSONSchema), and permissions
// are all defined at the same level. The pipeline extracts data fields
// for JSON Schema and filters out Kessel types automatically.

/** Host resource in the inventory service */
model Host {
  /** Every host belongs to exactly one RBAC workspace */
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;

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

  /** View permission: resolves to workspace.inventory_host_view */
  view: Permission<"workspace.inventory_host_view">;

  /** Update permission: resolves to workspace.inventory_host_update */
  update: Permission<"workspace.inventory_host_update">;
}
