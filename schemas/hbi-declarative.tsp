// HBI (Host Based Inventory) Service Schema — Declarative Extensions
// Uses Kessel.V1WorkspacePermission from lib/kessel-extensions.tsp
// instead of RBAC.V1BasedPermission. The patch rules live in the
// extension template, not in the emitter.

import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "./rbac.tsp";

using JsonSchema;
using Kessel;

namespace InventoryDecl;

// ─── Extension Applications ──────────────────────────────────────────

alias viewPermission = Kessel.V1WorkspacePermission<
  "inventory",
  "hosts",
  "read",
  "inventory_host_view"
>;

alias updatePermission = Kessel.V1WorkspacePermission<
  "inventory",
  "hosts",
  "write",
  "inventory_host_update"
>;

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

// ─── Host Resource Type ──────────────────────────────────────────────

model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  data: HostData;
  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;
}
