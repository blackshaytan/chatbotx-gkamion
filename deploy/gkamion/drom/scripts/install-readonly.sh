#!/bin/bash
# Install this reviewed artifact only on assistant, keeping all write gates closed.
set -euo pipefail
artifact=$(cd "$(dirname "$0")/.." && pwd)
profile=/opt/hermes-data/profiles/assistant
python_bin=${DROM_TEST_PYTHON:-/opt/hermes/uv-python/cpython-3.13-linux-x86_64-gnu/bin/python3.13}
export PYTHONPATH="/opt/data/mcp/gkamion-admin-api/.venv/lib/python3.13/site-packages${PYTHONPATH:+:$PYTHONPATH}"
(cd "$artifact" && sha256sum -c MANIFEST.sha256)
backup_dir=$(mktemp -d /opt/hermes-data/cache/scratch/drom-install-backup.XXXXXXXX)
cp -a "$profile/mcp/drom" "$backup_dir/mcp-drom"
cp -a "$profile/SOUL.md" "$backup_dir/SOUL.md"
cp -a "$profile/skills/geka-knowledge/references/drom.md" "$backup_dir/drom.md"
# The engine cannot be live during source replacement. Caller first uses the
# documented profile disable + reload sequence from README; never restart gateway.
"$python_bin" - "$profile/config.yaml" <<'PY'
import sys,yaml,os
from pathlib import Path
for proc in Path('/proc').glob('[0-9]*'):
 try:cwd=os.readlink(proc/'cwd')
 except (OSError,PermissionError):continue
 assert cwd!='/opt/hermes-data/profiles/assistant/mcp/drom', 'a production drom process is still live: reload disabled profile first'
config=yaml.safe_load(open(sys.argv[1]))
assert config['mcp_servers']['drom'].get('enabled') is False, 'disable drom and reload this profile first'
assert not config['mcp_servers']['drom'].get('env',{}).get('DROM_WRITE_RELEASE_SHA256'), 'remove write release flag first'
PY
cp "$artifact"/src/{drom_tools.py,drom_checkout.py,drom_transport.py,server.py,run.sh} "$profile/mcp/drom/"
cp "$artifact/profile/skills/geka-knowledge/references/drom.md" "$profile/skills/geka-knowledge/references/drom.md"
"$python_bin" - "$artifact/profile/SOUL.md" "$profile/SOUL.md" <<'PY'
from pathlib import Path
import sys
fragment=Path(sys.argv[1]).read_text().splitlines()
p=Path(sys.argv[2]);lines=p.read_text().splitlines()
new=next(x for x in fragment if x.startswith('- **ДРОМ: карточка'))
assert sum(x.startswith('- **ДРОМ: карточка') for x in lines)==1
assert any(x.startswith('- **Текущий выпуск ДРОМ') for x in lines), 'read-only rule must remain installed'
lines=[new if x.startswith('- **ДРОМ: карточка') else x for x in lines]
p.write_text('\n'.join(lines)+'\n')
PY
printf 'Installed read-only; backup=%s\n' "$backup_dir"
