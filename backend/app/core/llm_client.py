import json
import time
import httpx
from app.core.settings import get_settings

settings = get_settings()

class LLMClient:
    def __init__(self):
        self.base_url = settings.llm_base_url.rstrip("/")
        self.api_key = settings.llm_api_key
        self.model = settings.llm_model

    def chat_json(self, system_prompt: str, user_prompt: str, max_tokens: int = 300, temperature: float = 0.1) -> tuple[dict, float]:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        headers = {"Content-Type": "application/json"}
        if self.api_key and self.api_key != "dummy":
            headers["Authorization"] = f"Bearer {self.api_key}"

        start = time.perf_counter()
        with httpx.Client(base_url=self.base_url, timeout=60.0) as client:
            resp = client.post("/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        latency_ms = (time.perf_counter() - start) * 1000

        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)  # JSON mode guarantees an object
        return parsed, latency_ms

    def get_embeddings(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = {
            "model": self.model,
            "input": texts
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key and self.api_key != "dummy":
            headers["Authorization"] = f"Bearer {self.api_key}"

        with httpx.Client(base_url=self.base_url, timeout=60.0) as client:
            resp = client.post("/embeddings", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        embeddings = []
        for item in data["data"]:
            emb = item["embedding"]
            if isinstance(emb, list) and len(emb) > 0 and isinstance(emb[0], list):
                emb = emb[0]
            embeddings.append(emb)
        return embeddings

llm_client = LLMClient()
