# DROM protected checkout release artifact

This is an isolated reviewed artifact, NOT the installed production MCP. Production remains read-only; no real customer messages, baskets, orders, invoices, statuses or database migrations were used by this work.

## Local verification

```
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
DROM_TEST_PYTHON="$PWD/.venv/bin/python" ./run-tests.sh
```

All HTTP writes in tests target ephemeral 127.0.0.1 fixtures. Tests cover timeout-after-commit, delayed visibility, restart, concurrent independent OS processes, exact readback, price withdrawal, extras own terms, full composition, omitted/dropped choices and release gates. The stdio test starts this artifact with temporary state and proves blocked writes without constructing a real transport. No live model or real API is invoked.

`src/server.py` defaults to read-only. The legacy external checkout form stays permanently blocked. Activation of protected writes requires an explicit owner release of the exact code generation, after hosted checks, bridge deployment, review and backend readback compatibility verification. Do not activate now.

`profile` contains only DROM-specific fragments, not complete replacements for shared profile files. The read-only installer changes only the existing DROM SOUL invariant, DROM reference and MCP sources, with backups. It preserves the read-only gate and all unrelated policies. The code requires a persistent shared state directory on this single host; never clear it or deploy multiple independent writer directories.

## Repository integration and hosted CI

The integration branch adds this directory as `deploy/gkamion/drom` and adds `.github/workflows/drom-acceptance.yml`. Its parent contains the bridge commit `e32eb15e5d12df17169907d804994841590623ab`. Neither this historical base nor any guessed source may overwrite the newer running worker. The current image has no OCI source-revision label: the owner must identify the actual production source commit before an image build/release.

The workflow is real source supplied in this artifact; it has NOT run on GitHub. Initial push runs acceptance only. To build the worker on the *first* feature-branch push, set repository variables `DROM_BUILD_WORKER_SHA` to the exact integrated commit and `DROM_PRODUCTION_SOURCE_SHA` to the owner-verified production source first. This avoids relying on workflow_dispatch registration of a brand-new workflow on a non-default branch. The worker job refuses a wrong source base, runs full lint/types only on the hosted runner and publishes only `drom-<exact SHA>`, NEVER latest. After workflow registration on the default branch it also supports workflow_dispatch with expected_sha/build_worker/production_source_sha.

Owner commands (on an authenticated checkout, after setting the actual production source SHA):

```
# The exact local bundle path and final commit are recorded in result-2.md.
test -z "$(git status --porcelain)"  # use a clean checkout, never the dirty production tree
# Incremental bundle prerequisite; fetch only this local source commit if needed.
git fetch /GKamion/chatbotX 75ced3aade285cc9236db9070880d2f6ef263b4c:refs/remotes/drom-source/base
git fetch /opt/hermes-data/cache/scratch/drom-protected-checkout-20261108.bundle \
  refs/heads/fix/drom-protected-checkout-20261108:refs/remotes/drom-source/final
: "${PRODUCTION_SOURCE_SHA:?set the verified source SHA of the running production image}"
git switch -c fix/drom-protected-checkout-from-89ec90a "$PRODUCTION_SOURCE_SHA"
# Apply only the reviewed target commits to the verified production base.
# If production already contains the bridge by ancestry, do not duplicate it.
if ! git merge-base --is-ancestor e32eb15e5d12df17169907d804994841590623ab HEAD; then
  git cherry-pick e32eb15e5d12df17169907d804994841590623ab
fi
git cherry-pick drom-source/final
ci_sha=$(git rev-parse HEAD)
gh auth status
gh variable set DROM_BUILD_WORKER_SHA --repo blackshaytan/chatbotx-gkamion --body "$ci_sha"
gh variable set DROM_PRODUCTION_SOURCE_SHA --repo blackshaytan/chatbotx-gkamion --body "$PRODUCTION_SOURCE_SHA"
git push gkamion HEAD:refs/heads/fix/drom-protected-checkout-from-89ec90a
gh run list --repo blackshaytan/chatbotx-gkamion --branch fix/drom-protected-checkout-from-89ec90a \
  --workflow drom-acceptance.yml --commit "$ci_sha"
```

If cherry-pick conflicts, stop: never reset/stash/overwrite unrelated production-source fixes. The supplied commit is reviewable and narrow; source integration must preserve the actual new production code. A successful check on a different SHA is not acceptance of the integrated release SHA.

## Guarded worker deployment

After CI passes, use the emitted immutable registry digest. On the VPS:

```
scripts/prepare-worker-release.sh \
  ghcr.io/blackshaytan/chatbotx-gkamion-worker@sha256:ACTUAL_CI_DIGEST \
  sha256:13f4affc5e0ea361863133d54323ff12effa9e9434df85f9bec8b493a92eafa0 \
  "$ci_sha"
```

`ACTUAL_CI_DIGEST` must be the real successful job output, not an invented value. The helper validates formats, checks the observed image before/after pull, verifies the OCI revision and prepares a candidate/rollback image and compose overrides. It NEVER replaces or rolls back the worker. A private flock plus a check before compose up is not an atomic CAS against other deployments. Actual replacement/rollback must wait for an authoritative exclusive release window covering all writers; the owner must provide that coordination. Do not execute a stale compose override later. Nothing touches latest, migrations or Hermes. If production changed, preparation refuses.

## MCP installation remains read-only

First remove any write-release environment flag if present, disable only drom, and invoke the documented profile reload using the existing owner. On this host the known client is `/opt/hermes-data/cache/scratch/drom-profile-reload.py`:

```
hermes --profile assistant config set mcp_servers.drom.enabled false
/opt/hermes-data/tools/python-3.14.7+20260901-linux-x64/bin/python3 -I -c \
 'import sys,runpy;sys.path.insert(0,"/opt/hermes-build/hermes-agent");import hermes_bootstrap;runpy.run_path("/opt/hermes-data/cache/scratch/drom-profile-reload.py",run_name="__main__")'
scripts/install-readonly.sh
hermes --profile assistant config set mcp_servers.drom.enabled true
# Repeat the same profile reload, then verify actual child PID, generation and catalog.
```

Do not restart/kill the shared gateway. The installer verifies the manifest, disabled config, absence of a live production DROM process and absence of a write-release flag. It preserves the production read-only policy. It does NOT activate writes. Full activation is a separate owner release after external prerequisites; no unsafe raw-tool fallback exists.

Rollback: do not delete the attempt journal. Disable drom and profile-reload, restore the backed-up MCP/reference/SOUL while disabled, then re-enable/reload only if restoring the known safe read-only version. Worker rollback is not automated by this artifact; the prepared rollback override requires the same authoritative exclusive release coordination and a current-release check.
