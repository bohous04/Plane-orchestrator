#!/usr/bin/env bash
# Stub `claude` for runner tests. Echoes a runner-style result and exits 0.
#
# It accepts the same argv the runner builds. We don't care about most of them;
# this script just emits valid headers and the JSON output Claude Code would.
sleep 0.05
cat <<'EOF'
working...
some intermediate stdout
EOF
cat <<'JSON'
{"is_error":false,"result":"STATUS: SUCCESS\nSUMMARY: stub task done\nFILES: stub.ts","total_cost_usd":0.42,"num_turns":3}
JSON
exit 0
