#!/usr/bin/env bash
set -euo pipefail

SPICEDB_URL="${SPICEDB_URL:-http://localhost:8443}"
SPICEDB_KEY="${SPICEDB_KEY:-somerandomkeyhere}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Generating SpiceDB schema from TypeSpec ==="
SCHEMA=$(cd "$PROJECT_DIR" && npx tsx src/spicedb-emitter.ts schema/main.tsp 2>/dev/null | sed '/^\/\//d' | sed '/^Compiling/d' | sed '/^Warning/d' | sed '/^Discovered/d')

echo "=== Writing schema to SpiceDB at $SPICEDB_URL ==="
ESCAPED_SCHEMA=$(printf '%s' "$SCHEMA" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

RESPONSE=$(curl -s \
  "$SPICEDB_URL/v1/schema/write" \
  -H "Authorization: Bearer $SPICEDB_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"schema\": $ESCAPED_SCHEMA}")

echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'code' in data and data['code'] != 0:
    print('FAIL: Schema rejected by SpiceDB')
    print(json.dumps(data, indent=2))
    sys.exit(1)
else:
    print('PASS: Schema accepted by SpiceDB')
    print(json.dumps(data, indent=2))
"

echo ""
echo "=== Reading back schema from SpiceDB ==="
curl -s "$SPICEDB_URL/v1/schema/read" \
  -H "Authorization: Bearer $SPICEDB_KEY" \
  -d '{}' | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'schemaText' in data:
    print(data['schemaText'])
else:
    print(json.dumps(data, indent=2))
"
