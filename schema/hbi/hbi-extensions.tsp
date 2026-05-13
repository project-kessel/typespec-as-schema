// HBI Extension Templates
//
// Defines reusable extensions owned by the HBI (Host Based Inventory) provider.
// Other services (e.g., ROS) can call these extensions via alias instantiation
// to pass permissions through from workspace to host.

import "../../lib/kessel.tsp";

namespace Kessel;

/**
 * Exposes a workspace-level permission on the host resource.
 * The expansion adds a computed permission to inventory/host gated on
 * both the host's `view` relation and the workspace's v2 permission.
 *
 * Equivalent of KSL's `@hbi.expose_host_permission(v2_perm, host_perm)`.
 */
@provider("hbi")
model ExposeHostPermission<V2Perm extends string, HostPerm extends string> {
  /** The v2 permission name on workspace to pass through (e.g. "ros_read_analysis"). */
  v2Perm: V2Perm;

  /** The permission name to expose on host (e.g. "ros_read_analysis"). */
  hostPerm: HostPerm;
}
