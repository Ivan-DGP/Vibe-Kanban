#!/usr/bin/env bash
# Provision a project for Vibe Kanban to manage: clone (if a git URL) into
# $PROJECTS_DIR and register it with the running VK instance via its API.
#
# Usage (ON THE VPS):
#   deploy/add-project.sh <git-url|abs-path> [name] [--auto-spawn]
# Examples:
#   deploy/add-project.sh git@github.com:me/api.git api --auto-spawn
#   deploy/add-project.sh /home/vibe/projects/existing-repo
set -euo pipefail

SRC="${1:?usage: add-project.sh <git-url|abs-path> [name] [--auto-spawn]}"
NAME="${2:-}"
AUTO_SPAWN=0
for a in "$@"; do [ "$a" = "--auto-spawn" ] && AUTO_SPAWN=1; done

PORT="${PORT:-8080}"
API="http://localhost:$PORT/api"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"

# Resolve the on-disk path VK will use (must exist on this box).
if [ -d "$SRC/.git" ] || { [ -d "$SRC" ] && [ "${SRC#/}" != "$SRC" ]; }; then
  ABS_PATH="$(cd "$SRC" && pwd)"                       # existing local path
  [ -z "$NAME" ] && NAME="$(basename "$ABS_PATH")"
else
  [ -z "$NAME" ] && NAME="$(basename "$SRC" .git)"
  ABS_PATH="$PROJECTS_DIR/$NAME"
  if [ -d "$ABS_PATH/.git" ]; then
    echo "▶ repo exists, pulling: $ABS_PATH"
    git -C "$ABS_PATH" pull --ff-only
  else
    echo "▶ cloning $SRC → $ABS_PATH"
    mkdir -p "$PROJECTS_DIR"
    git clone "$SRC" "$ABS_PATH"
  fi
fi

echo "▶ registering '$NAME' → $ABS_PATH"
RESP="$(curl -sf -X POST "$API/projects" \
  -H 'content-type: application/json' \
  -d "{\"name\": \"$NAME\", \"path\": \"$ABS_PATH\"}")"
echo "$RESP"

# Extract the new project id (no jq dependency).
PID="$(printf '%s' "$RESP" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
if [ -z "$PID" ]; then
  echo "✖ could not parse project id — is VK running on :$PORT?"; exit 1
fi

if [ "$AUTO_SPAWN" = "1" ]; then
  echo "▶ enabling auto-spawn for $PID"
  curl -sf -X PATCH "$API/projects/$PID" \
    -H 'content-type: application/json' \
    -d '{"autoSpawnEnabled": true}' >/dev/null
  echo "  auto-spawn ON"
fi

echo "✔ '$NAME' added (id=$PID). Open the VK UI over Tailscale to use it."
