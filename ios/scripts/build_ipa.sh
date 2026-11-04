#!/bin/bash
# Word Chain Game - iOS Build & IPA Packaging Script
# --------------------------------------------------
# Usage:
#   ./ios/scripts/build_ipa.sh               (Unsigned / Ad-hoc / Sideloading IPA)
#   ./ios/scripts/build_ipa.sh --sign "Apple Development: Name (ID)" --profile "path/to/profile.mobileprovision"
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IOS_DIR="$REPO_ROOT/ios"
PROJECT="$IOS_DIR/WordChain.xcodeproj"
SCHEME="WordChain"
CONFIGURATION="Release"
BUILD_DIR="$IOS_DIR/build"
DERIVED_DATA="$BUILD_DIR/dd"
DIST_DIR="$REPO_ROOT/dist"
IPA_PATH="$DIST_DIR/WordChain.ipa"

SIGNING_IDENTITY=""
PROVISIONING_PROFILE=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --sign) SIGNING_IDENTITY="$2"; shift ;;
        --profile) PROVISIONING_PROFILE="$2"; shift ;;
        -h|--help)
            echo "Usage: $0 [--sign \"IDENTITY\"] [--profile \"PATH\"]"
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

echo "============================================="
echo "Building Word Chain Game for iOS"
echo "============================================="

# Ensure destination directories exist
mkdir -p "$DIST_DIR"

if [ -n "$SIGNING_IDENTITY" ]; then
    echo "Building with code signing: $SIGNING_IDENTITY"
    xcodebuild -project "$PROJECT" \
               -target "$SCHEME" \
               -configuration "$CONFIGURATION" \
               -sdk iphoneos \
               SYMROOT="$BUILD_DIR" \
               CODE_SIGN_IDENTITY="$SIGNING_IDENTITY" \
               CODE_SIGNING_REQUIRED=YES \
               CODE_SIGNING_ALLOWED=YES \
               build
else
    echo "Building unsigned (ready for TrollStore / AltStore / Sideloadly)..."
    xcodebuild -project "$PROJECT" \
               -target "$SCHEME" \
               -configuration "$CONFIGURATION" \
               -sdk iphoneos \
               SYMROOT="$BUILD_DIR" \
               CODE_SIGNING_ALLOWED=NO \
               build
fi

APP_BUNDLE="$BUILD_DIR/$CONFIGURATION-iphoneos/WordChain.app"

if [ ! -d "$APP_BUNDLE" ]; then
    echo "Error: App bundle not found at $APP_BUNDLE"
    exit 1
fi

echo "Packaging into $IPA_PATH..."
PAYLOAD_DIR="$BUILD_DIR/Payload"
rm -rf "$PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR"

cp -R "$APP_BUNDLE" "$PAYLOAD_DIR/"

# If custom mobileprovision provided, embed it into the app bundle
if [ -n "$PROVISIONING_PROFILE" ] && [ -f "$PROVISIONING_PROFILE" ]; then
    echo "Embedding provisioning profile: $PROVISIONING_PROFILE"
    cp "$PROVISIONING_PROFILE" "$PAYLOAD_DIR/WordChain.app/embedded.mobileprovision"
    if [ -n "$SIGNING_IDENTITY" ]; then
        echo "Resigning bundle with embedded profile..."
        codesign -f -s "$SIGNING_IDENTITY" --timestamp=none "$PAYLOAD_DIR/WordChain.app"
    fi
fi

# Create IPA archive
(cd "$BUILD_DIR" && rm -f "$IPA_PATH" && zip -qr "$IPA_PATH" "Payload")
rm -rf "$PAYLOAD_DIR"

cp -f "$IPA_PATH" "$REPO_ROOT/WordChain.ipa"

SIZE=$(du -h "$IPA_PATH" | awk '{print $1}')
echo "============================================="
echo "Successfully created IPA: $IPA_PATH ($SIZE)"
echo "Copied to project root: $REPO_ROOT/WordChain.ipa"
echo "============================================="
