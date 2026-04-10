// RBAC Service Schema — Augment-Based Extension Approach
// This alternative demonstrates using TypeSpec's `augment` to model
// cooperative extensions, where HBI adds properties to RBAC types.
//
// NOTE: This is an experimental alternative to the template approach
// in rbac.tsp. TypeSpec's `augment` allows one namespace to add
// properties to models defined in another namespace.

import "../lib/kessel.tsp";

using Kessel;

namespace RBACAugment;

model Principal {}

model Role {
  all_all_all: BoolRelation<Principal>;
}

model RoleBinding {
  subject: Assignable<Principal, Cardinality.Any>;
  granted: Assignable<Role, Cardinality.AtLeastOne>;
}

model Workspace {
  parent: Assignable<Workspace, Cardinality.AtMostOne>;
  user_grant: Assignable<RoleBinding, Cardinality.Any>;
}
