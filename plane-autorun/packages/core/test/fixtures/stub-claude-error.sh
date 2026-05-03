#!/usr/bin/env bash
# Stub `claude` that emits is_error JSON and exit code 1.
sleep 0.05
cat <<'JSON'
{"is_error":true,"result":"sandbox blew up","total_cost_usd":0.05}
JSON
exit 1
