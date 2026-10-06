# shellcheck shell=sh
# Shared helpers for building image assets from the SVGs in assets/. Sourced by
# scripts/buildIosImages.sh, scripts/buildAndroidImages.sh, and
# scripts/buildStoreImages.sh.
#
# Requires: ImageMagick (7's `magick`, or 6's `convert` as on Ubuntu). Optional:
# librsvg (`rsvg-convert`), which renders SVG features ImageMagick's built-in
# renderer can't, such as gradients.

IMAGES_REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)"
ICON_SVG="$IMAGES_REPO_ROOT/assets/icon.svg"
BACKGROUND_SVG="$IMAGES_REPO_ROOT/assets/background.svg"

# Leaves out the PNG timestamps, so identical images come out byte for byte the
# same: fastlane skips re-uploading unchanged store graphics by checksum.
PNG_NO_TIMES="png:exclude-chunks=date,time"

# Xcode and Android Studio run builds with a minimal PATH.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export PATH

images_require_tools() {
  if command -v magick >/dev/null 2>&1; then
    MAGICK=magick
  elif command -v convert >/dev/null 2>&1; then
    MAGICK=convert
  else
    echo "Error: ImageMagick is required to build images (brew install imagemagick)." >&2
    exit 1
  fi
  for svg in "$ICON_SVG" "$BACKGROUND_SVG"; do
    if [ ! -f "$svg" ]; then
      echo "Error: source SVG not found at $svg" >&2
      exit 1
    fi
    # ImageMagick's built-in SVG renderer silently draws these wrong (gradients
    # come out black), so they need librsvg's renderer.
    if ! command -v rsvg-convert >/dev/null 2>&1 &&
      grep -qE '<(linearGradient|radialGradient|filter|mask|clipPath|pattern|text|image)[ >]' "$svg"; then
      echo "Error: $svg uses SVG features ImageMagick can't render. Install librsvg (brew install librsvg)." >&2
      exit 1
    fi
  done
  IMAGES_TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/images.XXXXXX")
  trap 'rm -rf "$IMAGES_TMP_DIR"' EXIT
  trap 'exit 1' HUP INT TERM
}

# Width of an SVG's viewBox, used to pick a render density so the vector is
# rasterized at (at least) the target size rather than scaled up.
svg_viewbox_width() {
  sed -n 's/.*viewBox="[^ ]* [^ ]* \([0-9.]*\) [0-9.]*".*/\1/p' "$1" | head -n 1
}

# The mark without its "unlit" group (the dim LCD segments), for single-color
# icons and the title logo, where they'd be noise. web/build.ts drops them from
# the favicon too.
lit_icon_svg() {
  output="$IMAGES_TMP_DIR/icon-lit.svg"
  if [ ! -f "$output" ]; then
    sed '/<g id="unlit"/,/<\/g>/d' "$ICON_SVG" >"$output"
  fi
  printf '%s\n' "$output"
}

# rasterize <svg> <pixels> -> path of a transparent square PNG
# Uses librsvg when available (full SVG support), else ImageMagick's renderer.
rasterize() {
  svg=$1
  pixels=$2
  output="$IMAGES_TMP_DIR/$(basename "$svg" .svg)-$pixels.png"
  if [ ! -f "$output" ]; then
    if command -v rsvg-convert >/dev/null 2>&1; then
      rsvg-convert --width "$pixels" --height "$pixels" --keep-aspect-ratio \
        --output "$output" "$svg"
    else
      density=$(awk -v px="$pixels" -v w="$(svg_viewbox_width "$svg")" 'BEGIN { printf "%d", (px * 72 / w) + 1 }')
      # PNG32 keeps RGB even for an all-gray render, so later composites keep color.
      "$MAGICK" -background none -density "$density" "$svg" -resize "${pixels}x${pixels}" "PNG32:$output"
    fi
  fi
  printf '%s\n' "$output"
}

# mark_png <pixels> [fill-color] -> path of the rasterized mark; with a fill
# color, only its lit segments (for single-color icons)
mark_png() {
  if [ -n "${2:-}" ]; then
    rasterize "$(lit_icon_svg)" "$1"
  else
    rasterize "$ICON_SVG" "$1"
  fi
}

# render_mark <size> <mark-pixels> <output> [fill-color]
# The mark centered on a transparent square canvas. With a fill color, it's only
# the lit segments, every opaque pixel recolored (for monochrome icons).
render_mark() {
  size=$1
  mark=$2
  output=$3
  color=${4:-}
  mkdir -p "$(dirname "$output")"
  set -- "$(mark_png "$mark" "$color")" -background none -gravity center -extent "${size}x${size}"
  if [ -n "$color" ]; then
    set -- "$@" -fill "$color" -colorize 100
  fi
  "$MAGICK" "$@" -depth 8 -colorspace sRGB -type TrueColorAlpha "$output"
}

# render_foreground <size> <mark-pixels> <output> [fill-color]
# An adaptive icon layer: like render_mark, with the mark's bottom row stretched
# down to the canvas edge. The mark's columns touch its bottom edge, and the
# launcher's mask (and its parallax) can show more of the canvas than the mark.
render_foreground() {
  size=$1
  mark=$2
  output=$3
  color=${4:-}
  below=$(((size - mark) / 2))
  png=$(mark_png "$mark" "$color")
  mkdir -p "$(dirname "$output")"
  set -- "$png" -background none -gravity center -extent "${size}x${size}" \
    "(" "$png" -gravity south -crop "${mark}x1+0+0" +repage -scale "${mark}x${below}!" ")" \
    -gravity south -composite
  if [ -n "$color" ]; then
    set -- "$@" -fill "$color" -colorize 100
  fi
  "$MAGICK" "$@" -depth 8 -colorspace sRGB -type TrueColorAlpha "$output"
}

# render_background <width> <height> <output>
# The background scaled to cover the canvas and center-cropped. Opaque.
render_background() {
  width=$1
  height=$2
  output=$3
  if [ "$width" -gt "$height" ]; then longest=$width; else longest=$height; fi
  mkdir -p "$(dirname "$output")"
  "$MAGICK" "$(rasterize "$BACKGROUND_SVG" "$longest")" \
    -resize "${width}x${height}^" -gravity center -extent "${width}x${height}" \
    -background white -alpha remove -alpha off \
    -depth 8 -colorspace sRGB -type TrueColor -define png:color-type=2 "$output"
}

# render_icon <size> <output>
# The mark drawn full-bleed over the background. Opaque, as App Store icons must be.
render_icon() {
  size=$1
  output=$2
  mkdir -p "$(dirname "$output")"
  "$MAGICK" "$(rasterize "$BACKGROUND_SVG" "$size")" "$(rasterize "$ICON_SVG" "$size")" \
    -gravity center -composite \
    -background white -alpha remove -alpha off \
    -depth 8 -colorspace sRGB -type TrueColor -define png:color-type=2 -define "$PNG_NO_TIMES" "$output"
}

# render_logo <size> <output>
# The app icon without the mark's unlit segments, like the favicon, for the logo
# beside each app's title. Square and opaque; the apps round its corners.
render_logo() {
  size=$1
  output=$2
  mkdir -p "$(dirname "$output")"
  "$MAGICK" "$(rasterize "$BACKGROUND_SVG" "$size")" "$(rasterize "$(lit_icon_svg)" "$size")" \
    -gravity center -composite \
    -background white -alpha remove -alpha off \
    -depth 8 -colorspace sRGB -type TrueColor -define png:color-type=2 "$output"
}

# The background's average color as #RRGGBB, for places that only take a color.
background_average_color() {
  "$MAGICK" "$(rasterize "$BACKGROUND_SVG" 64)" -background white -alpha remove -alpha off \
    -resize '1x1!' -depth 8 -format '#%[hex:u.p{0,0}]' info:
}

# render_banner <width> <height> <output>
# The mark at full height on the background, its columns on the bottom edge.
# Opaque, as store graphics must be.
render_banner() {
  width=$1
  height=$2
  output=$3
  if [ "$width" -gt "$height" ]; then longest=$width; else longest=$height; fi
  mkdir -p "$(dirname "$output")"
  "$MAGICK" "$(rasterize "$BACKGROUND_SVG" "$longest")" \
    -resize "${width}x${height}^" -gravity center -extent "${width}x${height}" \
    "$(rasterize "$ICON_SVG" "$height")" -gravity south -composite \
    -background white -alpha remove -alpha off \
    -depth 8 -colorspace sRGB -type TrueColor -define png:color-type=2 -define "$PNG_NO_TIMES" "$output"
}
