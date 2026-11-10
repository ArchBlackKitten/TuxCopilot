#!/usr/bin/env bash
# Builds TuxCopilot and adds it to your application menu — for your user only, no sudo.
#
#   ./install.sh              build and install into ~/.local
#   ./install.sh --uninstall  remove what this script installed (your data is kept)
#
# PREFIX=/some/dir ./install.sh installs somewhere else.
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
BIN="$PREFIX/bin/tuxcopilot"
ICONS="$PREFIX/share/icons/hicolor"
DESKTOP="$PREFIX/share/applications/tuxcopilot.desktop"
cd "$(dirname "$0")"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN" "$DESKTOP" "$ICONS"/*/apps/tuxcopilot.png "$ICONS/scalable/apps/tuxcopilot.svg"
  echo "Removed TuxCopilot from $PREFIX."
  echo "Your data is still in ~/.local/share/tuxcopilot.desk/ — delete that folder to remove it too."
  exit 0
fi

# ── 1. everything needed is installed? ────────────────────────────────────
missing=()
for cmd in cargo npm node pkg-config; do
  command -v "$cmd" >/dev/null || missing+=("$cmd")
done
for lib in webkit2gtk-4.1 openssl sqlcipher; do
  pkg-config --exists "$lib" 2>/dev/null || missing+=("$lib")
done
if (( ${#missing[@]} )); then
  echo "Missing: ${missing[*]}"
  echo "Install the prerequisites first (see README.md, step 1):"
  echo "  sudo pacman -Syu --needed git base-devel rust nodejs npm webkit2gtk-4.1 openssl sqlcipher"
  exit 1
fi

# ── 2. build ──────────────────────────────────────────────────────────────
echo "==> Installing JavaScript packages (first time takes a minute)…"
npm ci --no-fund --no-audit

echo "==> Building the interface…"
npm run build

echo "==> Building the app (first time takes several minutes)…"
cargo build --release --locked --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml

# ── 3. install for this user ──────────────────────────────────────────────
# (it was called AppManager, then ArchManager: those menu entries go, your data moves on first start)
for old in appmanager archmanager; do
  rm -f "$PREFIX/bin/$old" "$PREFIX/share/icons/hicolor/128x128/apps/$old.png" "$PREFIX/share/applications/$old.desktop"
done
install -Dm755 src-tauri/target/release/tuxcopilot "$BIN"
# the icon at every size the desktop asks for: the one you chose in Settings → Look (kept in
# your data), or else the penguin (./make-icons.sh makes those from any picture)
MINE="$HOME/.local/share/tuxcopilot.desk/icon"
if [[ -f "$MINE/512.png" ]]; then
  for s in 32 64 128 256 512; do install -Dm644 "$MINE/$s.png" "$ICONS/${s}x${s}/apps/tuxcopilot.png"; done
  if [[ -f "$MINE/icon.svg" ]]; then install -Dm644 "$MINE/icon.svg" "$ICONS/scalable/apps/tuxcopilot.svg"; else rm -f "$ICONS/scalable/apps/tuxcopilot.svg"; fi
else
  for s in 32:32x32 64:64x64 128:128x128 256:128x128@2x 512:icon; do
    install -Dm644 "src-tauri/icons/${s#*:}.png" "$ICONS/${s%%:*}x${s%%:*}/apps/tuxcopilot.png"
  done
  [[ ! -f src-tauri/icons/icon.svg ]] || install -Dm644 src-tauri/icons/icon.svg "$ICONS/scalable/apps/tuxcopilot.svg"
fi
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=TuxCopilot
Comment=Saved commands, app installs, usage log and local LLMs for Arch Linux
Exec=$BIN
Icon=tuxcopilot
Terminal=false
Categories=System;
EOF

echo
echo "Done. Open TuxCopilot from your application menu, or run:  $BIN"
case ":$PATH:" in *":$PREFIX/bin:"*) ;; *) echo "(Tip: $PREFIX/bin is not on your PATH, so type the full path above.)" ;; esac
helper=""
for h in /usr/bin/ksshaskpass /usr/bin/lxqt-openssh-askpass /usr/lib/seahorse/ssh-askpass \
         /usr/lib/ssh/x11-ssh-askpass /usr/lib/ssh/ssh-askpass; do
  [[ -x "$h" ]] && helper="$h" && break
done
if [[ -z "$helper" && -z "${SUDO_ASKPASS:-}" ]]; then
  echo
  echo "Note: no password helper found. Play steps that use sudo will fail until you install one:"
  echo "  sudo pacman -Syu --needed ksshaskpass         (KDE Plasma)"
  echo "  sudo pacman -Syu --needed lxqt-openssh-askpass (any other desktop)"
fi
