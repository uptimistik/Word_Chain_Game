#!/bin/bash
set -e

# ==============================================================================
# build_apk.sh - Builds Word Chain Game for Android (.apk)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
APP_DIR="$ANDROID_DIR/app"
BUILD_DIR="$ANDROID_DIR/build"
DIST_DIR="$REPO_ROOT/dist"

echo "============================================="
echo "Building Word Chain Game for Android"
echo "============================================="

# 1. Detect Android SDK
ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ ! -d "$ANDROID_SDK" ]; then
    echo "ERROR: Android SDK not found at $ANDROID_SDK" >&2
    exit 1
fi

# Locate latest build-tools
BUILD_TOOLS_DIR=$(ls -d "$ANDROID_SDK/build-tools/"* 2>/dev/null | sort -V | tail -n 1)
if [ -z "$BUILD_TOOLS_DIR" ] || [ ! -d "$BUILD_TOOLS_DIR" ]; then
    echo "ERROR: No build-tools found in $ANDROID_SDK/build-tools" >&2
    exit 1
fi
echo "Using build-tools: $BUILD_TOOLS_DIR"

AAPT2="$BUILD_TOOLS_DIR/aapt2"
D8="$BUILD_TOOLS_DIR/d8"
ZIPALIGN="$BUILD_TOOLS_DIR/zipalign"
APKSIGNER="$BUILD_TOOLS_DIR/apksigner"

# Locate platform android.jar
PLATFORM_DIR=$(ls -d "$ANDROID_SDK/platforms/android-"* 2>/dev/null | sort -V | tail -n 1)
ANDROID_JAR="$PLATFORM_DIR/android.jar"
if [ ! -f "$ANDROID_JAR" ]; then
    echo "ERROR: android.jar not found at $ANDROID_JAR" >&2
    exit 1
fi
echo "Using platform: $PLATFORM_DIR"

# Locate javac
JAVAC="${JAVA_HOME:+$JAVA_HOME/bin/javac}"
if [ -z "$JAVAC" ] || [ ! -x "$JAVAC" ]; then
    JAVAC=$(which javac)
fi
if [ -z "$JAVAC" ]; then
    echo "ERROR: javac not found" >&2
    exit 1
fi
echo "Using javac: $JAVAC"

# 2. Sync web game into assets/www
echo "Syncing web game assets..."
"$ANDROID_DIR/scripts/sync_web.sh"

# 3. Clean & prepare build dirs
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/compiled_res" "$BUILD_DIR/gen" "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$DIST_DIR"

# 4. Compile Android resources
echo "Compiling resources with aapt2..."
"$AAPT2" compile --dir "$APP_DIR/src/main/res" -o "$BUILD_DIR/compiled_res/res.zip"

# 5. Link resources and assets into unsigned APK
echo "Linking resources and assets with aapt2..."
"$AAPT2" link \
    -I "$ANDROID_JAR" \
    --manifest "$APP_DIR/src/main/AndroidManifest.xml" \
    --java "$BUILD_DIR/gen" \
    -A "$APP_DIR/src/main/assets" \
    -o "$BUILD_DIR/unaligned_base.apk" \
    "$BUILD_DIR/compiled_res/res.zip"

# 6. Compile Java sources
echo "Compiling Java sources..."
"$JAVAC" \
    -cp "$ANDROID_JAR" \
    --release 11 \
    -d "$BUILD_DIR/classes" \
    "$BUILD_DIR/gen/com/wordchaingame/app/R.java" \
    "$APP_DIR/src/main/java/com/wordchaingame/app/"*.java

# 7. Convert bytecode to Dalvik (dex)
echo "Converting bytecode to dex with d8..."
CLASS_FILES=$(find "$BUILD_DIR/classes" -name "*.class")
"$D8" --release --min-api 24 --output "$BUILD_DIR/dex" $CLASS_FILES

# 8. Add classes.dex to APK
echo "Adding classes.dex to APK..."
(
    cd "$BUILD_DIR/dex"
    zip -q -u "$BUILD_DIR/unaligned_base.apk" classes.dex
)

# 9. Page-align APK
echo "Aligning APK with zipalign..."
"$ZIPALIGN" -p -f 4 "$BUILD_DIR/unaligned_base.apk" "$BUILD_DIR/aligned.apk"

# 10. Keystore check / creation
KEYSTORE="$HOME/.android/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
    echo "Creating debug keystore at $KEYSTORE..."
    mkdir -p "$HOME/.android"
    keytool -genkey -v \
        -keystore "$KEYSTORE" \
        -storepass android \
        -alias androiddebugkey \
        -keypass android \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US"
fi

# 11. Sign APK
TARGET_APK="$DIST_DIR/WordChain.apk"
echo "Signing APK with apksigner..."
"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-pass pass:android \
    --key-pass pass:android \
    --ks-key-alias androiddebugkey \
    --out "$TARGET_APK" \
    "$BUILD_DIR/aligned.apk"

# 12. Verify APK
echo "Verifying APK..."
"$APKSIGNER" verify --verbose "$TARGET_APK"

APK_SIZE=$(du -h "$TARGET_APK" | awk '{print $1}')
echo "============================================="
echo "Successfully created APK: $TARGET_APK ($APK_SIZE)"
echo "============================================="

