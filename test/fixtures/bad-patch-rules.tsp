import "../../lib/kessel.tsp";
import "../../lib/kessel-extensions.tsp";
import "../../schema/rbac.tsp";

using Kessel;

namespace TestBad;

// Valid alias — should pass validation
alias goodPermission = Kessel.V1WorkspacePermission<
  "test",
  "things",
  "read",
  "test_thing_view"
>;
