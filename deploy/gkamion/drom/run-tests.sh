#!/bin/sh
set -eu
cd "$(dirname "$0")"
export PYTHONPATH="$PWD/src:$PWD/tests${PYTHONPATH:+:$PYTHONPATH}"
exec "${DROM_TEST_PYTHON:-python3}" -m unittest discover -s tests -v
