#!/bin/bash
# Builds and publishes each arch sequentially to avoid sha512 mismatch
# caused by parallel code-signing when using --publish always directly.
set -e

echo "→ Building renderer / main / preload..."
npx electron-vite build

echo "→ Publishing arm64..."
npx electron-builder --mac --arm64 --publish always

echo "→ Publishing x64..."
npx electron-builder --mac --x64 --publish always

echo "✓ Release complete"
