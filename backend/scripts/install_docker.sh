#!/usr/bin/env bash
# install_docker.sh — silently mount and install Docker Desktop from DMG
set -e

DMG="${1:-$HOME/Downloads/docker-install/Docker.dmg}"

if [ ! -f "$DMG" ]; then
  echo "❌ DMG not found: $DMG"
  echo "   Still downloading? Check: ls -lh ~/Downloads/docker-install/Docker.dmg"
  exit 1
fi

DMG_SIZE=$(du -sh "$DMG" | cut -f1)
echo "=== Installing Docker Desktop from: $DMG ($DMG_SIZE) ==="
echo ""

# Mount the DMG
echo "→ Mounting DMG..."
MOUNT_POINT=$(hdiutil attach "$DMG" -nobrowse -quiet | grep "/Volumes/" | awk '{print $3}')
echo "  Mounted at: $MOUNT_POINT"

# Copy Docker.app to Applications
echo "→ Copying Docker.app to /Applications/ ..."
cp -R "$MOUNT_POINT/Docker.app" /Applications/

# Unmount
echo "→ Unmounting..."
hdiutil detach "$MOUNT_POINT" -quiet

echo ""
echo "✅ Docker Desktop installed to /Applications/Docker.app"
echo ""
echo "→ Opening Docker Desktop (first launch takes ~30 seconds)..."
open /Applications/Docker.app

echo ""
echo "After Docker starts:"
echo "  1. Accept the license agreement in the Docker Desktop UI"
echo "  2. Wait for the whale icon to appear in your menu bar (green = ready)"
echo "  3. Then run: docker ps   ← should return empty table, no error"
echo "  4. Then run: pip install harbor && harbor run --help"
