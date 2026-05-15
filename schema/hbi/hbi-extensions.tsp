// HBI Extension Templates
//
// Defines reusable extensions owned by the HBI (Host Based Inventory) team.
// Other services (e.g., ROS) can instantiate these via alias to pass
// permissions through from workspace to host.

import "../../lib/kessel.tsp";

using TypeSpec.Reflection;

namespace HBI;

/**
 * Exposes a workspace-level permission on the host resource via decorator.
 * Alternative to the template alias `HBI.ExposeHostPermission<...>`.
 */
extern dec exposeHostPermission(
  target: Model,
  v2Perm: valueof string,
  hostPerm: valueof string,
);

/**
 * Exposes a workspace-level permission on the host resource.
 * The expansion adds a computed permission to inventory/host gated on
 * both the host's `view` relation and the workspace's v2 permission.
 *
 * Equivalent of TS-POC's has_permission_on_workspace() pattern.
 */
model ExposeHostPermission<V2Perm extends string, HostPerm extends string> {
  /** The v2 permission name on workspace to pass through. */
  v2Perm: V2Perm;

  /** The permission name to expose on host. */
  hostPerm: HostPerm;
}
