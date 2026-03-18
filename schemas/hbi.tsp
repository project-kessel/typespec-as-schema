// HBI (Host Based Inventory) Service Schema
// Defines the host resource type with data fields, validation rules,
// and permissions derived from RBAC workspace permission extensions.

import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "./rbac.tsp";

using JsonSchema;
using Kessel;

namespace Inventory;

// ─── Extension Applications ──────────────────────────────────────────
// These invoke the RBAC workspace permission template.
// A custom emitter reads these and expands the template on Role,
// RoleBinding, and Workspace.

/** Maps inventory:hosts:read → inventory_host_view on workspace */
alias viewPermission = RBAC.V1BasedPermission<
  "inventory",
  "hosts",
  "read",
  "inventory_host_view"
>;

/** Maps inventory:hosts:write → inventory_host_update on workspace */
alias updatePermission = RBAC.V1BasedPermission<
  "inventory",
  "hosts",
  "write",
  "inventory_host_update"
>;

// ─── Host Data Schema (→ JSONSchema) ─────────────────────────────────
// Native TypeSpec types with validation decorators.
// The @jsonSchema decorator makes this emit as JSONSchema.

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
// Combines relations (→ SpiceDB) and data fields (→ JSONSchema).

/** Host resource in the inventory service */
model Host {
  // ── Assignable relation ──
  /** Every host belongs to exactly one RBAC workspace */
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;

  // ── Data fields ──
  /** Host data fields with validation */
  data: HostData;

  // ── Computed permissions (via RBAC extension) ──
  /** View permission: resolves to workspace.inventory_host_view */
  view: Permission<"workspace.inventory_host_view">;

  /** Update permission: resolves to workspace.inventory_host_update */
  update: Permission<"workspace.inventory_host_update">;
}
