#!/usr/bin/env bash
# download_model.sh — download a small GGUF model for llama.cpp
# Default: Qwen2.5-7B-Instruct-Q4_K_M (~4.4 GB, strong reasoning, fast on CPU)
set -e

MODEL_DIR="$(dirname "$0")/../models"
mkdir -p "$MODEL_DIR"

MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf"
MODEL_FILE="$MODEL_DIR/qwen2.5-7b-instruct-q4_k_m.gguf"

if [ -f "$MODEL_FILE" ]; then
  echo "✅ Model already exists: $MODEL_FILE"
  exit 0
fi

echo "=== Downloading Qwen2.5-7B-Instruct-Q4_K_M (~4.4 GB) ==="
echo "From: $MODEL_URL"
echo "To:   $MODEL_FILE"
echo ""
echo "This may take several minutes depending on your connection..."
echo ""

curl -L --progress-bar -o "$MODEL_FILE" "$MODEL_URL"

echo ""
echo "✅ Model downloaded: $MODEL_FILE"
echo ""
echo "Start the server with:  bash scripts/start_llama_server.sh"
