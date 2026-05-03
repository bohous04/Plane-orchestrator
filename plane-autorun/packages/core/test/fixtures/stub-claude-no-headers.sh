#!/usr/bin/env bash
# Stub `claude` that produces JSON without the required header contract.
sleep 0.05
cat <<'JSON'
{"is_error":false,"result":"random freeform output\nno headers here","total_cost_usd":0.20}
JSON
exit 0
