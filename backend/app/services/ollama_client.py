import httpx
from typing import List, Dict, Any, Optional

class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(base_url=self.base_url, timeout=60.0)

    async def list_models(self) -> List[Dict[str, Any]]:
        response = await self.client.get("/api/tags")
        response.raise_for_status()
        data = response.json()
        return data.get("models", [])

    async def generate(self, model: str, prompt: str, temperature: float = 0.7, max_tokens: Optional[int] = None) -> str:
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

    async def close(self):
        await self.client.aclose()
