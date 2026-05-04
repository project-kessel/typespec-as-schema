#!/usr/bin/env bash
set -euo pipefail

SPICEDB_URL="${SPICEDB_URL:-http://localhost:8443}"
SPICEDB_KEY="${SPICEDB_KEY:-somerandomkeyhere}"
PASS=0
FAIL=0

call_api() {
  local endpoint=$1
  local payload=$2
  curl -s "$SPICEDB_URL$endpoint" \
    -H "Authorization: Bearer $SPICEDB_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

write_rel() {
  local resource_type=$1
  local resource_id=$2
  local relation=$3
  local subject_type=$4
  local subject_id=$5
  local subject_relation=${6:-""}

  local subject_ref="{\"object\":{\"objectType\":\"$subject_type\",\"objectId\":\"$subject_id\"}}"
  if [ -n "$subject_relation" ]; then
    subject_ref="{\"object\":{\"objectType\":\"$subject_type\",\"objectId\":\"$subject_id\"},\"optionalRelation\":\"$subject_relation\"}"
  fi

  local payload="{\"updates\":[{\"operation\":\"OPERATION_TOUCH\",\"relationship\":{\"resource\":{\"objectType\":\"$resource_type\",\"objectId\":\"$resource_id\"},\"relation\":\"$relation\",\"subject\":$subject_ref}}]}"

  local result
  result=$(call_api "/v1/relationships/write" "$payload")
  if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'writtenAt' in d else 1)" 2>/dev/null; then
    echo "  OK: $resource_type:$resource_id#$relation@$subject_type:$subject_id${subject_relation:+#$subject_relation}"
  else
    echo "  ERR: $resource_type:$resource_id#$relation@$subject_type:$subject_id${subject_relation:+#$subject_relation}"
    echo "       $result"
    return 1
  fi
}

check_perm() {
  local expected=$1
  local resource_type=$2
  local resource_id=$3
  local permission=$4
  local subject_type=$5
  local subject_id=$6

  local payload="{\"resource\":{\"objectType\":\"$resource_type\",\"objectId\":\"$resource_id\"},\"permission\":\"$permission\",\"subject\":{\"object\":{\"objectType\":\"$subject_type\",\"objectId\":\"$subject_id\"}},\"consistency\":{\"fullyConsistent\":true}}"

  local result
  result=$(call_api "/v1/permissions/check" "$payload")
  local permissionship
  permissionship=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('permissionship','UNKNOWN'))" 2>/dev/null || echo "ERROR")

  local actual
  if [ "$permissionship" = "PERMISSIONSHIP_HAS_PERMISSION" ]; then
    actual="ALLOW"
  else
    actual="DENY"
  fi

  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $resource_type:$resource_id#$permission for $subject_type:$subject_id => $actual"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $resource_type:$resource_id#$permission for $subject_type:$subject_id => $actual (expected $expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Writing test relationships ==="
echo ""
echo "--- Workspace hierarchy: org1 is parent of team_a ---"
write_rel "rbac/workspace" "team_a" "t_parent" "rbac/workspace" "org1"

echo ""
echo "--- Role: viewer_role has inventory_hosts_read (grants inventory_host_view) ---"
write_rel "rbac/role" "viewer_role" "t_inventory_hosts_read" "rbac/principal" "*"

echo ""
echo "--- Role: editor_role has inventory_hosts_write (grants inventory_host_update) ---"
write_rel "rbac/role" "editor_role" "t_inventory_hosts_write" "rbac/principal" "*"

echo ""
echo "--- Role: admin_role has any_any_any (grants everything) ---"
write_rel "rbac/role" "admin_role" "t_any_any_any" "rbac/principal" "*"

echo ""
echo "--- RoleBinding: bind alice as viewer in org1 ---"
write_rel "rbac/role_binding" "rb_alice_viewer" "t_subject" "rbac/principal" "alice"
write_rel "rbac/role_binding" "rb_alice_viewer" "t_granted" "rbac/role" "viewer_role"

echo ""
echo "--- RoleBinding: bind bob as editor in org1 ---"
write_rel "rbac/role_binding" "rb_bob_editor" "t_subject" "rbac/principal" "bob"
write_rel "rbac/role_binding" "rb_bob_editor" "t_granted" "rbac/role" "editor_role"

echo ""
echo "--- RoleBinding: bind carol as admin in org1 ---"
write_rel "rbac/role_binding" "rb_carol_admin" "t_subject" "rbac/principal" "carol"
write_rel "rbac/role_binding" "rb_carol_admin" "t_granted" "rbac/role" "admin_role"

echo ""
echo "--- Workspace bindings: attach role_bindings to org1 ---"
write_rel "rbac/workspace" "org1" "t_binding" "rbac/role_binding" "rb_alice_viewer"
write_rel "rbac/workspace" "org1" "t_binding" "rbac/role_binding" "rb_bob_editor"
write_rel "rbac/workspace" "org1" "t_binding" "rbac/role_binding" "rb_carol_admin"

echo ""
echo "--- Host: host1 belongs to workspace team_a ---"
write_rel "inventory/host" "host1" "t_workspace" "rbac/workspace" "team_a"

echo ""
echo "========================================="
echo "=== Permission checks ==="
echo "========================================="

echo ""
echo "--- Alice (viewer): can view, cannot update ---"
check_perm "ALLOW" "inventory/host" "host1" "view" "rbac/principal" "alice"
check_perm "DENY"  "inventory/host" "host1" "update" "rbac/principal" "alice"

echo ""
echo "--- Bob (editor): cannot view (only has write, not read), can update ---"
check_perm "DENY"  "inventory/host" "host1" "view" "rbac/principal" "bob"
check_perm "ALLOW" "inventory/host" "host1" "update" "rbac/principal" "bob"

echo ""
echo "--- Carol (admin: any_any_any): can view and update ---"
check_perm "ALLOW" "inventory/host" "host1" "view" "rbac/principal" "carol"
check_perm "ALLOW" "inventory/host" "host1" "update" "rbac/principal" "carol"

echo ""
echo "--- Dave (no bindings): cannot view or update ---"
check_perm "DENY" "inventory/host" "host1" "view" "rbac/principal" "dave"
check_perm "DENY" "inventory/host" "host1" "update" "rbac/principal" "dave"

echo ""
echo "--- Workspace-level checks ---"
check_perm "ALLOW" "rbac/workspace" "org1" "inventory_host_view" "rbac/principal" "alice"
check_perm "ALLOW" "rbac/workspace" "team_a" "inventory_host_view" "rbac/principal" "alice"
check_perm "ALLOW" "rbac/workspace" "org1" "view_metadata" "rbac/principal" "alice"

echo ""
echo "========================================="
echo "=== Results: $PASS passed, $FAIL failed ==="
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
