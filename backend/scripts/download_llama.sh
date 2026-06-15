#!/usr/bin/env bash
# download_llama.sh — download Llama-3.2-3B-Instruct-Q4_K_M GGUF model with auto-resume support
set -e

MODEL_DIR="$(dirname "$0")/../models"
mkdir -p "$MODEL_DIR"

MODEL_URL="https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
MODEL_FILE="$MODEL_DIR/Llama-3.2-3B-Instruct-Q4_K_M.gguf"

if [ -f "$MODEL_FILE" ] && [ ! -f "${MODEL_FILE}.part" ]; then
  # check size to see if it's completely downloaded
  FILE_SIZE=$(wc -c <"$MODEL_FILE" 2>/dev/null || echo 0)
  if [ "$FILE_SIZE" -gt 1500000000 ]; then
    echo "✅ Model already completely exists: $MODEL_FILE ($FILE_SIZE bytes)"
    exit 0
  fi
fi

echo "=== Downloading Llama-3.2-3B-Instruct-Q4_K_M (~2.0 GB) ==="
echo "From: $MODEL_URL"
echo "To:   $MODEL_FILE"
echo ""
echo "This may take several minutes depending on your connection..."
echo "Auto-resume is enabled."
echo ""

MAX_RETRIES=15
RETRY_COUNT=0
success=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  echo "Attempt $((RETRY_COUNT + 1)) of $MAX_RETRIES..."
  # Use curl -C - to auto-resume the transfer
  if curl -C - -L --progress-bar -o "$MODEL_FILE" "$MODEL_URL"; then
    success=true
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "Download interrupted (curl code $?). Waiting 5 seconds before resuming..."
  sleep 5
done

if [ "$success" = false ]; then
  echo "❌ Failed to download model after $MAX_RETRIES attempts."
  exit 1
fi

echo ""
echo "✅ Model downloaded: $MODEL_FILE"
echo ""
