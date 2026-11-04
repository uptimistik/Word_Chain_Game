#!/bin/sh
# Copies the GameSalad HTML5 export (index.html, css, js, game, images) from the
# repository root into the Android app's assets/www folder.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST="$REPO_ROOT/android/app/src/main/assets/www"

mkdir -p "$DEST"
rsync -a --delete \
  --exclude ".DS_Store" \
  --exclude "cordova-app.js" \
  "$REPO_ROOT/index.html" \
  "$REPO_ROOT/3d.html" \
  "$REPO_ROOT/favicon.ico" \
  "$REPO_ROOT/css" \
  "$REPO_ROOT/js" \
  "$REPO_ROOT/game" \
  "$REPO_ROOT/images" \
  "$REPO_ROOT/assets" \
  "$REPO_ROOT/OriginalTileImages" \
  "$DEST/"

echo "Synced web game into $DEST"

