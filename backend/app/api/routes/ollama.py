from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services.ollama_client import OllamaClient

router = APIRouter(prefix="/ollama", tags=["ollama"])
client = OllamaClient()

class GenerateRequest(BaseModel):
    model: str
    prompt: str
    temperature: float = 0.7
    max_tokens: Optional[int] = None

@router.get("/models")
async def get_models():
    try:
        models = await client.list_models()
        return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate")
async def generate(req: GenerateRequest):
    try:
        response = await client.generate(
            model=req.model,
            prompt=req.prompt,
            temperature=req.temperature,
            max_tokens=req.max_tokens
        )
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
