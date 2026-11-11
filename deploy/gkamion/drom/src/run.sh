#!/bin/sh
cd "$(dirname "$0")" || exit 1
PY=/opt/hermes/uv-python/cpython-3.13-linux-x86_64-gnu/bin/python3.13
export PYTHONPATH="/opt/data/mcp/gkamion-admin-api/.venv/lib/python3.13/site-packages${PYTHONPATH:+:$PYTHONPATH}"
exec "$PY" server.py
