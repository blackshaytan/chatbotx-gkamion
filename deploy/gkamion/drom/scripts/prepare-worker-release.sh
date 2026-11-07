#!/bin/bash
# Owner-run preparation after hosted checks and verified source integration; NEVER swaps production.
set -euo pipefail
if [[ $# != 3 ]]; then
  echo 'usage: prepare-worker-release.sh IMMUTABLE_GHCR_IMAGE EXPECTED_CURRENT_IMAGE_ID EXPECTED_SOURCE_SHA' >&2
  exit 2
fi
release_image=$1
expected_current=$2
expected_source=$3
[[ $release_image =~ ^ghcr\.io/blackshaytan/chatbotx-gkamion-worker@sha256:[0-9a-f]{64}$ ]]
[[ $expected_current =~ ^sha256:[0-9a-f]{64}$ ]]
[[ $expected_source =~ ^[0-9a-f]{40}$ ]]
exec 9>/tmp/drom-worker-release.lock
flock -n 9
[[ $(docker inspect chatbotx-prod-worker-1 --format '{{.Image}}') == "$expected_current" ]]
docker pull "$release_image"
[[ $(docker image inspect "$release_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$expected_source" ]]
release_dir=$(mktemp -d /opt/hermes-data/cache/scratch/drom-worker-release.XXXXXXXX)
printf 'services:\n  worker:\n    image: %s\n' "$release_image" > "$release_dir/worker.yml"
docker inspect chatbotx-prod-worker-1 --format '{{.Image}} {{.Created}}' > "$release_dir/before.txt"
rollback_tag="chatbotx-worker:drom-rollback-$(date -u +%Y%m%dT%H%M%SZ)"
docker tag "$expected_current" "$rollback_tag"
printf '%s\n' "$rollback_tag" > "$release_dir/rollback-image.txt"
printf 'services:\n  worker:\n    image: %s\n' "$rollback_tag" > "$release_dir/rollback.yml"
# Preparation only. A private lock cannot serialize unrelated release writers.
# Do not execute compose up/rollback here: an authoritative exclusive release
# window across ALL writers must be established by the production owner first.
[[ $(docker inspect chatbotx-prod-worker-1 --format '{{.Image}}') == "$expected_current" ]]
printf '%s\n' "$release_image" > "$release_dir/candidate-image.txt"
printf '%s\n' "$expected_source" > "$release_dir/candidate-source.txt"
printf 'Prepared only: %s\nNo worker replacement or rollback was executed.\n' "$release_dir"
printf 'Owner must coordinate an exclusive release window across all deploy writers.\n'
