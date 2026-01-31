#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export COURT_BROWSER_FRESH=1

exec "$REPO_ROOT/scripts/run-court.sh"
