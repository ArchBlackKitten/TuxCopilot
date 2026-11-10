#!/usr/bin/env bash
# Makes every icon TuxCopilot needs from one picture — yours to change any time.
#
#   ./make-icons.sh                       uses Arts/Icon/Penguin.svg
#   ./make-icons.sh path/to/picture.svg   any square SVG (best: sharp at every size)
#   ./make-icons.sh path/to/picture.png   or a square PNG, 1024×1024 or bigger
#
# Then ./install.sh puts the new icon in your menu (and the app's window and header).
# Nothing is downloaded: Tauri's icon tool is already in node_modules.
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:-Arts/Icon/Penguin.svg}"
OUT=src-tauri/icons
[[ -f "$SRC" ]] || { echo "No picture at $SRC"; exit 1; }
[[ -d node_modules ]] || { echo "Run ./install.sh once first (it fetches the build tools), then this again."; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "==> Drawing $SRC at 32, 64, 128, 256 and 512 pixels…"
npx --no-install tauri icon "$SRC" -o "$tmp" -p 32 -p 64 -p 128 -p 256 -p 512 >/dev/null

# the names tauri.conf.json and install.sh look for
rm -f "$OUT"/*.png "$OUT"/*.svg "$OUT"/icon.ico "$OUT"/icon.icns
mkdir -p "$OUT"
cp "$tmp/32x32.png" "$OUT/32x32.png"
cp "$tmp/64x64.png" "$OUT/64x64.png"
cp "$tmp/128x128.png" "$OUT/128x128.png"
cp "$tmp/256x256.png" "$OUT/128x128@2x.png"
cp "$tmp/512x512.png" "$OUT/icon.png"
# an SVG also goes in as it is: the desktop draws it sharp at any size
case "$SRC" in *.svg | *.SVG) cp "$SRC" "$OUT/icon.svg" ;; esac
# the app's own header and its window tab
cp "$tmp/128x128.png" public/logo.png

echo "Done: $(ls "$OUT" | tr '\n' ' ')"
echo "Now run ./install.sh to see it in your menu."
