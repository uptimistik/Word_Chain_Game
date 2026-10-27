#!/bin/sh
# Copies the GameSalad HTML5 export (index.html, css, js, game, images) from the
# repository root into the app bundle's www/ folder. Runs as an Xcode
# "Run Script" build phase, so the iOS app always ships the current web build.
set -e

REPO_ROOT="${SRCROOT}/.."
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/www"

mkdir -p "$DEST"
rsync -a --delete \
  --exclude ".DS_Store" \
  --exclude "cordova-app.js" \
  "$REPO_ROOT/index.html" \
  "$REPO_ROOT/css" \
  "$REPO_ROOT/js" \
  "$REPO_ROOT/game" \
  "$REPO_ROOT/images" \
  "$DEST/"

echo "Synced web game into $DEST"
