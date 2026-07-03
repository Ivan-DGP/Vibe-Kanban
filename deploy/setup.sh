#!/usr/bin/env bash
# One-shot, idempotent setup/update for a Vibe Kanban VPS deployment.
# Safe to re-run: use it to first provision, and later to deploy new code.
#
# What it does:
#   - installs Bun (if missing) and verifies the `claude` CLI is present + authed
#   - clones/updates the VK repo, installs deps, builds the client
#   - installs a systemd service (runs as $APP_USER, starts on boot, auto-restarts)
#     with a PATH that includes `claude` + the auto-resume env
#   - exposes it TAILNET-ONLY via `tailscale serve` (never public — VK has no auth
#     and runs `claude --dangerously-skip-permissions` = arbitrary code execution)
#
# Run ON THE VPS as the app user (has sudo for the unit install):
#   chmod +x deploy/setup.sh && ./deploy/setup.sh
set -euo pipefail

# ── Config (override via env) ─────────────────────────────────────────────────
APP_USER="${APP_USER:-$(id -un)}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
APP_DIR="${APP_DIR:-$APP_HOME/vibe-kanban}"
REPO_URL="${REPO_URL:-https://github.com/Ivan-DGP/Vibe-Kanban.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8080}"
DATA_DIR="${VK_DATA_DIR:-$APP_HOME/vibe-kanban-data}"
PROJECTS_DIR="${PROJECTS_DIR:-$APP_HOME/projects}"
# Tune to the VPS RAM — each concurrent claude run is memory-hungry.
VK_HEADLESS_CLAUDE_CONCURRENCY="${VK_HEADLESS_CLAUDE_CONCURRENCY:-2}"

BUN="$APP_HOME/.bun/bin/bun"

echo "▶ Vibe Kanban VPS setup  (user=$APP_USER app=$APP_DIR port=$PORT)"

# ── Bun ───────────────────────────────────────────────────────────────────────
if [ ! -x "$BUN" ] && ! command -v bun >/dev/null 2>&1; then
  echo "▶ installing bun"
  curl -fsSL https://bun.sh/install | bash
fi
BUN="$(command -v bun || echo "$BUN")"

# ── Claude CLI (must exist + be authenticated as $APP_USER) ───────────────────
if ! command -v claude >/dev/null 2>&1; then
  cat <<'MSG'
✖ `claude` CLI not found on PATH.
  Install it (either works):
     curl -fsSL https://claude.ai/install.sh | bash      # native → ~/.local/bin
     npm install -g @anthropic-ai/claude-code            # npm global
  Then AUTHENTICATE as this user (once), e.g.:
     claude            # complete the login prompt over SSH
     # or, headless:   claude setup-token
  Re-run this script afterwards.
MSG
  exit 1
fi
CLAUDE_BIN="$(command -v claude)"
CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"
echo "▶ claude: $CLAUDE_BIN"
if [ ! -d "$APP_HOME/.claude" ] && [ ! -f "$APP_HOME/.claude.json" ]; then
  echo "⚠ No ~/.claude auth found for $APP_USER — run \`claude\` once to log in, or VK will fall back to an API key."
fi

# ── Code: clone or update ─────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  echo "▶ updating repo ($BRANCH)"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
else
  echo "▶ cloning repo"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "▶ install deps + build client"
( cd "$APP_DIR" && "$BUN" install && "$BUN" run build )

mkdir -p "$DATA_DIR" "$PROJECTS_DIR"

# ── systemd unit ──────────────────────────────────────────────────────────────
UNIT=/etc/systemd/system/vibe-kanban.service
echo "▶ writing $UNIT"
sudo tee "$UNIT" >/dev/null <<UNIT
[Unit]
Description=Vibe Kanban
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
# PATH must include claude + bun so VK can spawn the CLI.
Environment=PATH=$CLAUDE_DIR:$APP_HOME/.bun/bin:$APP_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=VK_DATA_DIR=$DATA_DIR
Environment=HOME=$APP_HOME
# Auto-resume after usage-limit (on by default; tune as needed)
Environment=VK_AUTORESUME_ENABLED=1
Environment=VK_RESUME_SWEEP_MS=60000
Environment=VK_HEADLESS_CLAUDE_CONCURRENCY=$VK_HEADLESS_CLAUDE_CONCURRENCY
ExecStart=$BUN run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now vibe-kanban.service
sudo systemctl restart vibe-kanban.service
sleep 2
sudo systemctl --no-pager --lines=5 status vibe-kanban.service || true

# ── Expose TAILNET-ONLY ───────────────────────────────────────────────────────
if command -v tailscale >/dev/null 2>&1; then
  echo "▶ tailscale serve → localhost:$PORT (tailnet-only)"
  sudo tailscale serve --bg "$PORT" 2>/dev/null || \
    echo "  (adjust manually: 'tailscale serve --bg $PORT'; check 'tailscale serve status')"
fi

echo "✔ Done. Health check:"
echo "    curl -s http://localhost:$PORT/api/claude/status"
echo "  Add a project with: deploy/add-project.sh <git-url|abs-path> [name] [--auto-spawn]"
