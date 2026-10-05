#!/bin/sh
set -e

# Build iOS image assets from assets/icon.svg and assets/background.svg.
# Outputs are gitignored; the app target also runs this as a build phase.
# Requires: ImageMagick

# shellcheck source=scripts/lib/images.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib/images.sh"
images_require_tools

ASSETS_DIR="$IMAGES_REPO_ROOT/ios/NoiseConnoisseur/Assets.xcassets"

# Launch screen logo size in points (see ios/NoiseConnoisseur/LaunchScreen.storyboard).
LAUNCH_LOGO_POINTS=100

echo "Generating iOS images from assets/"

icon_size=1024
render_icon "$icon_size" $((icon_size * ICON_MARK_PERCENT / 100)) \
  "$ASSETS_DIR/AppIcon.appiconset/AppIcon.png"
echo "  AppIcon.png (${icon_size}x${icon_size})"

# Large enough to aspect-fill the biggest iPad; the storyboard scales it down.
render_background 2732 2732 "$ASSETS_DIR/LaunchBackground.imageset/LaunchBackground.png"
echo "  LaunchBackground.png (2732x2732)"

for scale in 2 3; do
  pixels=$((LAUNCH_LOGO_POINTS * scale))
  render_mark "$pixels" "$pixels" "$ASSETS_DIR/LaunchLogo.imageset/LaunchLogo@${scale}x.png"
  echo "  LaunchLogo@${scale}x.png (${pixels}x${pixels})"
done
