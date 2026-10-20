#!/usr/bin/env bash
# Builds the ChatbotX images inside a resource-capped BuildKit container so the
# build cannot starve the other services on this VPS (Geka, n8n, Dashboard).
# Images are built one at a time and loaded into the local docker engine.
#
# Usage: deploy/gkamion/build.sh [service ...]   (default: all four)
# Limits (env): BUILD_MEMORY (default 6g RAM), BUILD_MEMORY_SWAP (RAM + swap,
# default 14g: the Next.js build needs more than 6g and spills into swap instead
# of taking RAM from other services), BUILD_CPUS (default 0-3 = 4 cores).
# Changing a limit needs `docker buildx rm chatbotx-limited` first.
# The host needs free swap for the spill; see README "Building".
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BUILDER_NAME=chatbotx-limited
BUILD_MEMORY=${BUILD_MEMORY:-6g}
BUILD_MEMORY_SWAP=${BUILD_MEMORY_SWAP:-14g}
BUILD_CPUS=${BUILD_CPUS:-0-3}
SERVICES=("$@")
[ ${#SERVICES[@]} -gt 0 ] || SERVICES=(builder worker realtime javascript-executor)

if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER_NAME" --driver docker-container \
    --driver-opt "memory=$BUILD_MEMORY,memory-swap=$BUILD_MEMORY_SWAP,cpuset-cpus=$BUILD_CPUS"
fi

cd "$ROOT"
for service in "${SERVICES[@]}"; do
  echo "== building $service (memory $BUILD_MEMORY, cpus $BUILD_CPUS)"
  nice -n 10 docker buildx build --builder "$BUILDER_NAME" --load \
    -f "apps/$service/docker/Dockerfile" \
    -t "chatbotx-gkamion/$service:latest" .
done
echo "Built: ${SERVICES[*]}. Start with deploy/gkamion/up.sh"
