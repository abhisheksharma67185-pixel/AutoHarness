#!/usr/bin/env bash
# start_llama_server.sh — start llama.cpp OpenAI-compatible server (Apple Silicon optimised)
set -e

MODEL_DIR="$(dirname "$0")/../models"
MODEL_FILE="${1:-$MODEL_DIR/Llama-3.2-3B-Instruct-Q4_K_M.gguf}"

# Fallback if default Llama model doesn't exist but Qwen does
if [ ! -f "$MODEL_FILE" ]; then
  if [ -f "$MODEL_DIR/qwen2.5-0.5b-instruct-q4_k_m.gguf" ] && [ -z "$1" ]; then
    MODEL_FILE="$MODEL_DIR/qwen2.5-0.5b-instruct-q4_k_m.gguf"
  else
    echo "❌ Model file not found: $MODEL_FILE"
    echo "   Available models:"
    ls -lh "$MODEL_DIR"/*.gguf 2>/dev/null || echo "   (none yet — still downloading?)"
    exit 1
  fi
fi

# Detect chat format
CHAT_FORMAT="llama-3"
if [[ "$MODEL_FILE" == *"qwen"* ]]; then
  CHAT_FORMAT="chatml"
fi

MODEL_SIZE=$(du -sh "$MODEL_FILE" | cut -f1)
echo "=== llama.cpp OpenAI-compatible server ==="
echo "Model:       $MODEL_FILE ($MODEL_SIZE)"
echo "Chat Format: $CHAT_FORMAT"
echo "URL:         http://localhost:8080/v1/chat/completions"
echo ""
echo "Test with:"
echo '  curl http://localhost:8080/v1/chat/completions \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"model":"local","messages":[{"role":"user","content":"Say hi in one sentence"}]}'"'"
echo ""
echo "Press Ctrl+C to stop."
echo ""

/usr/bin/python3 -m llama_cpp.server \
  --model "$MODEL_FILE" \
  --host 0.0.0.0 \
  --port 8080 \
  --n_ctx 4096 \
  --n_threads 4 \
  --n_gpu_layers -1 \
  --chat_format "$CHAT_FORMAT" \
  --embedding True


