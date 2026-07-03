#!/bin/bash
# Build locally, upload with gh — electron-builder's GitHub publisher races
# against itself (duplicate publisher tasks re-upload the same assets and
# overwrite each other), leaving release assets inconsistent with
# latest-mac.yml. Building with --publish never and uploading the finished
# artifacts in one gh call is deterministic: one build state, one upload.
#
# Note: package.json declares arch:["arm64","x64"] in its targets, so a single
# electron-builder run builds both arches — never run it once per arch.
set -e

REPO="createdbynoone/bmp"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo "→ Building renderer / main / preload..."
npx electron-vite build

echo "→ Building arm64 & x64 artifacts (no publish)..."
npx electron-builder --mac --publish never

echo "→ Verifying latest-mac.yml against local artifacts..."
# x64 artifacts have no arch suffix: BMP-1.4.1-mac.zip / BMP-1.4.1.dmg
for zip in "release/BMP-$VERSION-mac.zip" "release/BMP-$VERSION-arm64-mac.zip"; do
  local_sha=$(openssl dgst -sha512 -binary "$zip" | base64)
  grep -qF "$local_sha" release/latest-mac.yml || { echo "✗ sha512 mismatch for $zip"; exit 1; }
done
echo "  sha512 OK"

echo "→ Uploading to GitHub release $TAG..."
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 || gh release create "$TAG" --repo "$REPO" --title "$VERSION" --notes "BMP $VERSION"
gh release upload "$TAG" \
  "release/BMP-$VERSION.dmg" \
  "release/BMP-$VERSION.dmg.blockmap" \
  "release/BMP-$VERSION-mac.zip" \
  "release/BMP-$VERSION-mac.zip.blockmap" \
  "release/BMP-$VERSION-arm64.dmg" \
  "release/BMP-$VERSION-arm64.dmg.blockmap" \
  "release/BMP-$VERSION-arm64-mac.zip" \
  "release/BMP-$VERSION-arm64-mac.zip.blockmap" \
  release/latest-mac.yml \
  --repo "$REPO" --clobber

echo "✓ Release complete"
