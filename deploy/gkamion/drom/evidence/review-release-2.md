One important concrete defect remains: [install-readonly.sh:8](/opt/hermes-data/cache/scratch/drom-finish2/scripts/install-readonly.sh:8) requires `MANIFEST.sha256`, but that file is absent from the reviewed artifact. With `set -e`, installation exits before backup or installation.

Otherwise, no important defects found in the requested scope:

- The worker helper only prepares artifacts; it executes no replacement, rollback, stop or restart. It requires owner coordination across all deployment writers and claims no atomic CAS.
- First feature-branch push triggers acceptance. Worker publishing uses the exact commit tag, never `latest`; preparation requires an immutable digest.
- Installation preserves state, retains read-only gates and narrowly updates DROM policy content.

Static review only. No edits, tests, network/API, env/auth/config access or subagents. Core was not re-reviewed.