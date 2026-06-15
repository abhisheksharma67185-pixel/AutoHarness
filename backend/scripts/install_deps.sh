#!/usr/bin/env bash
# install_deps.sh — one-shot backend setup
set -e

echo "=== AutoHarness Studio Backend — Dependency Installer ==="
echo ""

PYTHON=python3
PIP="$PYTHON -m pip"

# 1. Core backend deps
echo "→ Installing core backend dependencies..."
$PIP install -r "$(dirname "$0")/../requirements.txt"

# 2. Harbor CLI (for running Terminal-Bench jobs)
echo ""
echo "→ Installing Harbor CLI..."
$PIP install harbor

# 3. llama-cpp-python (bundles llama-server, no Homebrew needed)
echo ""
echo "→ Installing llama-cpp-python (this may take a few minutes)..."
$PIP install llama-cpp-python

echo ""
echo "✅ All dependencies installed."
echo ""
echo "Next steps:"
echo "  1. Download a model:        bash scripts/download_model.sh"
echo "  2. Start llama.cpp server:  bash scripts/start_llama_server.sh"
echo "  3. Ingest sample data:      python3 scripts/dev_ingest.py"
echo "  4. Start FastAPI server:    python3 -m uvicorn main:app --reload --port 8000"
