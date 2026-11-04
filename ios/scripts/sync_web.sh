#!/bin/sh
# Copies the GameSalad HTML5 export (index.html, css, js, game, images) from the
# repository root into the app bundle's www/ folder. Runs as an Xcode
# "Run Script" build phase, so the iOS app always ships the current web build.
set -e

if [ -n "$SRCROOT" ]; then
    REPO_ROOT="$(cd "$SRCROOT/.." && pwd)"
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

if [ -n "$TARGET_BUILD_DIR" ] && [ -n "$UNLOCALIZED_RESOURCES_FOLDER_PATH" ]; then
    DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/www"
elif [ -d "$REPO_ROOT/ios/build/dd/Build/Products/Release-iphoneos/WordChain.app" ]; then
    DEST="$REPO_ROOT/ios/build/dd/Build/Products/Release-iphoneos/WordChain.app/www"
else
    echo "Running outside Xcode build phase; build_ipa.sh will run this phase during xcodebuild."
    exit 0
fi

mkdir -p "$DEST"
rsync -a --delete \
  --exclude ".DS_Store" \
  --exclude "cordova-app.js" \
  "$REPO_ROOT/index.html" \
  "$REPO_ROOT/3d.html" \
  "$REPO_ROOT/css" \
  "$REPO_ROOT/js" \
  "$REPO_ROOT/game" \
  "$REPO_ROOT/images" \
  "$REPO_ROOT/OriginalTileImages" \
  "$DEST/"

# Ensure compiled Assets.car and AppIcons are copied into the app bundle
if [ -n "$TARGET_BUILD_DIR" ] && [ -n "$UNLOCALIZED_RESOURCES_FOLDER_PATH" ]; then
    APP_DIR="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
    if [ -f "$REPO_ROOT/ios/WordChain/Assets.car" ]; then
        cp -f "$REPO_ROOT/ios/WordChain/Assets.car" "$APP_DIR/"
    fi
    cp -f "$REPO_ROOT"/ios/WordChain/AppIcon*.png "$APP_DIR/" 2>/dev/null || true
fi

echo "Synced web game into $DEST"
