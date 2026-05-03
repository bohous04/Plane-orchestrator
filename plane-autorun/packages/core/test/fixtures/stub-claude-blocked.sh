#!/usr/bin/env bash
# Stub `claude` that reports BLOCKED.
sleep 0.05
cat <<'JSON'
{"is_error":false,"result":"STATUS: BLOCKED\nSUMMARY: ambiguity in spec\nFILES: none","total_cost_usd":0.10,"num_turns":1}
JSON
exit 0
