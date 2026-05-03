#!/usr/bin/env bash
# Stub `claude` that ignores SIGTERM and hangs, to test the SIGKILL fallback.
trap '' TERM
echo "starting"
sleep 60
echo "still alive"
