#!/bin/sh
set -e

# Build all native image assets from the SVGs in assets/.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"

echo "=== Building iOS images ==="
sh "$SCRIPT_DIR/buildIosImages.sh"

echo ""
echo "=== Building Android images ==="
sh "$SCRIPT_DIR/buildAndroidImages.sh"
