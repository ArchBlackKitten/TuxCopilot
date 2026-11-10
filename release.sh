#!/usr/bin/env bash
# Makes a signed TuxCopilot release, for the AUR and for anyone who wants to check it:
#
#   release/tuxcopilot-<version>.tar.gz          the source, exactly as tagged
#   release/tuxcopilot-<version>.tar.gz.asc      its GPG signature (the release key)
#   release/tuxcopilot-<version>.tar.gz.sha256   its checksum
#
# and a signed tag v<version>. The version is the one in src-tauri/Cargo.toml (package.json
# and tauri.conf.json must agree). Nothing is uploaded: the last lines say what to run.
#
#   ./release.sh
#   ./release.sh --use-key <fingerprint>   change the release key, everywhere (no release)
#
# gpg asks for the release key's passphrase (once for the tag, once for the tarball).
set -euo pipefail
cd "$(dirname "$0")"

# the release key: one file holds its fingerprint, everything else is written from it
KEY="${TUXCOPILOT_RELEASE_KEY:-$(tr -d '[:space:]' < keys/release-key)}"
OUT=release

spaced() { echo "$1" | sed -E 's/(.{4})/\1 /g; s/ $//; s/^((.{4} ){5})/\1 /'; }
# the AUR reads .SRCINFO, not the PKGBUILD: written from each (makepkg only reads it, fetches nothing)
srcinfo() { for d in packaging packaging/tuxcopilot-git; do (cd "$d" && makepkg --printsrcinfo > .SRCINFO); done; }

if [[ "${1:-}" == "--use-key" ]]; then
  NEW=$(echo "${2:-}" | tr -d '[:space:]' | tr a-f A-F)
  [[ "$NEW" =~ ^[0-9A-F]{40}$ ]] || { echo "Give the new key's full fingerprint (40 characters): gpg --list-secret-keys"; exit 1; }
  gpg --list-secret-keys "$NEW" >/dev/null 2>&1 || { echo "That key is not among your secret keys."; exit 1; }
  OLD="$KEY"
  NAME_UID=$(gpg --list-keys --with-colons "$NEW" | awk -F: '/^uid/{print $10; exit}' | sed 's/ <.*//')
  # its public half beside the old one (old releases stay checkable with the old key)
  gpg --armor --export "$NEW" > "keys/pgp/$NEW.asc"
  echo "$NEW" > keys/release-key
  sed -i -E "s/^validpgpkeys=.*/validpgpkeys=('$NEW') # $NAME_UID/" packaging/PKGBUILD
  srcinfo
  sed -i -e "s/$OLD/$NEW/g" -e "s/$(spaced "$OLD")/$(spaced "$NEW")/g" -e "s/^ArchBlackKitten (TuxCopilot releases)\$/$NAME_UID/" README.md
  echo "The release key is now $(spaced "$NEW") ($NAME_UID):"
  echo "  keys/release-key, keys/pgp/$NEW.asc, packaging/PKGBUILD (and its .SRCINFO) and README.md are updated."
  echo "Still yours to do:"
  echo "  1. Vouch for the new key with the old one, so people who trust the old key can trust the new:"
  echo "       gpg --local-user $OLD --sign-key $NEW"
  echo "     then export it again: gpg --armor --export $NEW > keys/pgp/$NEW.asc"
  echo "  2. Add the new key to your GitHub account (Settings → SSH and GPG keys)."
  echo "  3. Commit, and make the next release with ./release.sh."
  echo "  4. If the old key was stolen, revoke it: gpg --import ~/.gnupg/openpgp-revocs.d/$OLD.rev"
  echo "     (remove the ':' before -----BEGIN in that file first), and publish the revoked key."
  exit 0
fi

V=$(grep -m1 '^version' src-tauri/Cargo.toml | cut -d'"' -f2)
for f in package.json src-tauri/tauri.conf.json; do
  grep -q "\"version\": \"$V\"" "$f" || { echo "$f does not say version $V — make them agree first."; exit 1; }
done
[[ -z "$(git status --porcelain)" ]] || { echo "Commit everything first: a release is exactly what is committed."; exit 1; }
gpg --list-secret-keys "$KEY" >/dev/null 2>&1 || { echo "The release key $KEY is not in your keyring."; exit 1; }

TAG="v$V"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  [[ "$(git rev-list -n1 "$TAG")" == "$(git rev-parse HEAD)" ]] || { echo "$TAG already exists on another commit: raise the version."; exit 1; }
  echo "==> $TAG is already this commit."
else
  echo "==> Signing the tag $TAG…"
  # commits are signed with your SSH key; releases with the GPG release key (makepkg checks GPG)
  git -c gpg.format=openpgp -c user.signingkey="$KEY" tag -s "$TAG" -m "TuxCopilot $V"
fi

NAME="tuxcopilot-$V"
mkdir -p "$OUT"
echo "==> Packing $NAME.tar.gz…"
git archive --format=tar.gz --prefix="$NAME/" -o "$OUT/$NAME.tar.gz" "$TAG"
echo "==> Signing it…"
gpg --yes --armor --local-user "$KEY" --detach-sign --output "$OUT/$NAME.tar.gz.asc" "$OUT/$NAME.tar.gz"
(cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")

# read back: a release that was not checked is a claim, not a release
gpg --verify "$OUT/$NAME.tar.gz.asc" "$OUT/$NAME.tar.gz" 2>&1 | grep -q 'Good signature' || { echo "The signature does not verify."; exit 1; }
(cd "$OUT" && sha256sum -c --quiet "$NAME.tar.gz.sha256")

SUM=$(cut -d' ' -f1 "$OUT/$NAME.tar.gz.sha256")
sed -i -e "s/^pkgver=.*/pkgver=$V/" -e "s/^sha256sums=.*/sha256sums=('$SUM' 'SKIP')/" packaging/PKGBUILD
srcinfo

echo
echo "Done: $OUT/$NAME.tar.gz, signed and checked. packaging/PKGBUILD and .SRCINFO now name it: commit them."
echo "To publish (not done for you):"
echo "  git push origin main $TAG"
echo "  gh release create $TAG $OUT/$NAME.tar.gz $OUT/$NAME.tar.gz.asc $OUT/$NAME.tar.gz.sha256 --title \"TuxCopilot $V\""
echo "Then the AUR (once: git clone ssh://aur@aur.archlinux.org/tuxcopilot.git ../aur-tuxcopilot):"
echo "  cp packaging/PKGBUILD packaging/.SRCINFO ../aur-tuxcopilot/ && cd ../aur-tuxcopilot && git add PKGBUILD .SRCINFO && git commit -m \"$V\" && git push"
echo "  (tuxcopilot-git the same way, from packaging/tuxcopilot-git/, into its own AUR clone)"
