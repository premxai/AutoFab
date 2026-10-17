#!/usr/bin/env bash
# AutoFab test gate. Every PR must pass this. Module owners append their selftests below their marker.
set -e
cd "$(dirname "$0")/.."
echo "== contracts present"; test -f docs/CONTRACTS.md && test -f docs/blueprint.schema.json && test -f samples/run.sample.json
echo "== sample run.json is valid JSON"; python -c "import json;json.load(open('samples/run.sample.json'))"
echo "== schema is valid JSON"; python -c "import json;json.load(open('docs/blueprint.schema.json'))"
# --- engine/orders (owner: engine/orders branch)
python -m engine.orders --selftest
# --- engine/inspector (owner: engine/inspector branch)
python -m engine.inspector --selftest
# --- engine/client (owner: engine/client branch; import-only without a key)
python -c "import engine.client"   # import-only fast path; full check (needs key): python -m engine.client --selftest
# --- web/api (owner: web/api branch)
echo "== server.py: /run.json, /menu.json guard, POST /order"
PORT=8799
python -m uvicorn server:app --port $PORT --log-level warning &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -f orders/live_test_*.json' EXIT
for i in $(seq 1 40); do curl -sf localhost:$PORT/run.json > /dev/null && break; sleep 0.25; done
curl -sf localhost:$PORT/run.json | python -c "import json,sys;d=json.load(sys.stdin);assert 'shifts' in d and 'versions' in d"
curl -sf localhost:$PORT/ > /dev/null
curl -sf localhost:$PORT/web/netlistsvg.bundle.js -o /dev/null && curl -sf localhost:$PORT/web/elk.bundled.js -o /dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' localhost:$PORT/runs/..%2Fserver.json)" = "404"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:$PORT/order -H 'content-type: application/json' -d '{"title":"t"}')" = "422"
RESP=$(curl -s -w '
%{http_code}' -X POST localhost:$PORT/order -H 'content-type: application/json' -d '{"rung":2,"version":"v1"}')
test "$(echo "$RESP" | tail -1)" = "202"
RID=$(echo "$RESP" | head -1 | python -c "import json,sys;print(json.load(sys.stdin)['run_id'])")
test -f "orders/$RID.json" && rm -f "orders/$RID.json"
echo "== OK"
