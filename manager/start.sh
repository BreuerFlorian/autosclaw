#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$SCRIPT_DIR"

# Ensure node is on PATH (nvm, fnm, or system)
if command -v node &>/dev/null; then
    : # already available
elif [ -d "$HOME/.nvm" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi

cd "$REPO_DIR"
git pull --ff-only

cd "$APP_DIR"
npm install --omit=dev

# Build the React frontend (need devDependencies for tsc & vite)
rm -rf "$APP_DIR/src/public"
cd "$APP_DIR/ui"
NODE_ENV=development npm install
npm run build
cd "$APP_DIR"

exec npm start
