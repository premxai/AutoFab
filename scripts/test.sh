#!/usr/bin/env bash
# AutoFab test gate. Every PR must pass this. Module owners append their selftests below their marker.
set -e
cd "$(dirname "$0")/.."
echo "== contracts present"; test -f docs/CONTRACTS.md && test -f docs/blueprint.schema.json && test -f samples/run.sample.json
echo "== sample run.json is valid JSON"; python -c "import json;json.load(open('samples/run.sample.json'))"
echo "== schema is valid JSON"; python -c "import json;json.load(open('docs/blueprint.schema.json'))"
# --- engine/orders (owner: engine/orders branch)
# python -m engine.orders --selftest
# --- engine/inspector (owner: engine/inspector branch)
# python -m engine.inspector --selftest
# --- engine/client (owner: engine/client branch; import-only without a key)
python -c "import engine.client"   # import-only fast path; full check (needs key): python -m engine.client --selftest
# --- web/api (owner: web/api branch)
# curl -sf localhost:8000/run.json > /dev/null
echo "== OK"
