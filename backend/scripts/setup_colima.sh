#!/usr/bin/env bash
# setup_colima.sh — Install Lima + start Colima Docker runtime (no Homebrew needed)
# Run AFTER Lima tarball is downloaded to /tmp/lima-arm64.tar.gz
set -e

echo "=== Setting up Colima Docker Runtime ==="
echo ""

LIMA_TAR="/tmp/lima-arm64.tar.gz"
BIN_DIR="$HOME/bin"

if [ ! -f "$LIMA_TAR" ]; then
  echo "❌ Lima tarball not found: $LIMA_TAR"
  echo "   Download with:"
  echo "   curl -L -o /tmp/lima-arm64.tar.gz \\"
  echo "     'https://ghfast.top/https://github.com/lima-vm/lima/releases/download/v1.0.5/lima-1.0.5-Darwin-arm64.tar.gz'"
  exit 1
fi

mkdir -p "$BIN_DIR"

# Extract limactl and qemu support binaries
echo "→ Extracting Lima binaries..."
tar -xzf "$LIMA_TAR" -C /tmp/lima-extract/ 2>/dev/null || (mkdir -p /tmp/lima-extract && tar -xzf "$LIMA_TAR" -C /tmp/lima-extract/)
find /tmp/lima-extract -name "limactl" -exec cp {} "$BIN_DIR/limactl" \;
chmod +x "$BIN_DIR/limactl"
echo "  limactl: $("$BIN_DIR/limactl" --version 2>/dev/null || echo 'installed')"

# Verify colima can find limactl
export PATH="$BIN_DIR:$PATH"
echo "  colima: $("$BIN_DIR/colima" version 2>/dev/null | head -1)"

echo ""
echo "→ Starting Colima VM (2 CPU, 4GB RAM, 20GB disk)..."
"$BIN_DIR/colima" start \
  --cpu 2 \
  --memory 4 \
  --disk 20 \
  --arch aarch64 \
  --vm-type vz \
  2>&1

echo ""
echo "→ Testing Docker..."
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
"$BIN_DIR/docker" ps

echo ""
echo "✅ Docker runtime ready via Colima!"
echo ""
echo "Add to your shell (~/.zshrc):"
echo '  export PATH="$HOME/bin:$PATH"'
echo '  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"'
echo ""
echo "Then Harbor can run agents:"
echo "  harbor run --dataset terminal-bench@2.0 --agent oracle --jobs-dir ./harbor_jobs"
