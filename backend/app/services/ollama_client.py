import httpx
from typing import List, Dict, Any, Optional
from app.core.settings import get_settings

class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(base_url=self.base_url, timeout=10.0)
        self.settings = get_settings()

    async def list_models(self) -> List[Dict[str, Any]]:
        # 1. Try Ollama (11434)
        try:
            response = await self.client.get("/api/tags")
            response.raise_for_status()
            data = response.json()
            return data.get("models", [])
        except Exception as e:
            # 2. Try llama.cpp (8080)
            try:
                async with httpx.AsyncClient(timeout=10.0) as cli:
                    url = f"{self.settings.llm_base_url}/models"
                    resp = await cli.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                    models = []
                    for m in data.get("data", []):
                        name = m.get("id", "")
                        short_name = name.split("/")[-1] if "/" in name else name
                        models.append({
                            "name": short_name,
                            "model": name,
                            "details": {"parameter_size": "3B"}
                        })
                    return models
            except Exception as e2:
                # 3. Static fallback
                return [
                    {
                        "name": "local-llama-3b",
                        "model": "local-llama-3b",
                        "details": {"parameter_size": "3B"}
                    }
                ]

    async def generate(self, model: str, prompt: str, temperature: float = 0.7, max_tokens: Optional[int] = None) -> str:
        # 1. Try Ollama (11434)
        try:
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": temperature
                }
            }
            if max_tokens is not None:
                payload["options"]["num_predict"] = max_tokens

            response = await self.client.post("/api/generate", json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("response", "")
        except Exception as e:
            # 2. Try llama.cpp (8080)
            try:
                async with httpx.AsyncClient(timeout=60.0) as cli:
                    url = f"{self.settings.llm_base_url}/chat/completions"
                    payload = {
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": temperature
                    }
                    if max_tokens is not None:
                        payload["max_tokens"] = max_tokens
                    resp = await cli.post(url, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
            except Exception as e2:
                return f"Error: Failed to connect to LLM provider (Ollama or llama.cpp). Detail: {e2}"

    async def close(self):
        await self.client.aclose()
