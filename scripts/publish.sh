#!/bin/bash
# Single electron-builder invocation: package.json declares arch:["arm64","x64"]
# in its targets, so CLI --arm64/--x64 flags do NOT filter — running the builder
# twice builds BOTH arches twice (each ad-hoc signed differently) and leaves
# GitHub with assets mixed from two build states, so latest-mac.yml sha512
# never matches. One run = one build state = consistent yml + assets.
set -e

echo "→ Building renderer / main / preload..."
npx electron-vite build

echo "→ Building + publishing arm64 & x64 (single run)..."
npx electron-builder --mac --publish always

echo "✓ Release complete"
