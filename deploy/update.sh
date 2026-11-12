#!/usr/bin/env bash
# Pulls the latest commit from GitHub and, if anything changed, reinstalls
# dependencies, rebuilds the client and restarts the app.
# Run by the sat-update timer every 2 minutes. Use --force to redeploy anyway.
# Everything lives inside main() so bash has read the whole script before
# git replaces this file.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  local branch="${BRANCH:-main}"
  local stamp=".deployed-commit"

  git fetch --quiet origin "$branch"
  local remote deployed
  remote=$(git rev-parse "origin/$branch")
  deployed=$(cat "$stamp" 2>/dev/null || echo none)

  if [ "$remote" = "$deployed" ] && [ "${1:-}" != "--force" ]; then
    exit 0
  fi

  echo "Deploying $deployed -> $remote"

  # Which files changed since the last good deploy (everything if unknown).
  local changed="ALL"
  if [ "${1:-}" != "--force" ] && git cat-file -e "$deployed^{commit}" 2>/dev/null; then
    changed=$(git diff --name-only "$deployed" "$remote")
  fi
  touches() { [ "$changed" = "ALL" ] || grep -q "$1" <<<"$changed"; }

  git reset --hard --quiet "$remote"

  if touches '^server/package'; then
    echo "Installing server dependencies"
    npm ci --prefix server --omit=dev --no-audit --no-fund
  fi
  if touches '^client/package'; then
    echo "Installing client dependencies"
    npm ci --prefix client --no-audit --no-fund
  fi
  if touches '^client/'; then
    echo "Building client"
    npm run build --prefix client
  fi

  sudo /usr/bin/systemctl restart sat
  echo "$remote" > "$stamp"
  echo "Deployed $remote"
}

main "$@"
