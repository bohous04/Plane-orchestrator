#!/usr/bin/env bash
# Stub `claude` that ignores SIGTERM and hangs, to test the SIGKILL fallback.
# Use `exec sleep` so bash itself becomes the sleep process — that way SIGKILL
# on the spawned PID actually terminates the process tree (no detached child
# leak).
trap '' TERM
echo "starting"
exec sleep 60
