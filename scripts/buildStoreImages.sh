#!/bin/sh
set -e

# Build the Google Play listing graphics from assets/icon.svg and
# assets/background.svg: the 512x512 app icon and the 1024x500 feature graphic,
# named as fastlane supply expects. `fastlane android metadata` runs this; pass
# a directory to write them elsewhere than the gitignored .screenshots/android/.
# Requires: ImageMagick
#
# Usage: buildStoreImages.sh [output-dir]

# shellcheck source=scripts/lib/images.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib/images.sh"
images_require_tools

OUTPUT_DIR=${1:-$IMAGES_REPO_ROOT/.screenshots/android}

render_icon 512 "$OUTPUT_DIR/icon.png"
echo "  $OUTPUT_DIR/icon.png (512x512)"
render_banner 1024 500 "$OUTPUT_DIR/featureGraphic.png"
echo "  $OUTPUT_DIR/featureGraphic.png (1024x500)"
