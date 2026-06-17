from fastapi import APIRouter, HTTPException
from app.domain.schemas.pipeline import PipelineGraph, PipelineValidationError
from app.services.pipeline_validation import validate_pipeline

router = APIRouter(prefix="/pipelines", tags=["pipelines"])

@router.post("/validate")
async def validate_pipeline_route(graph: PipelineGraph):
    try:
        validate_pipeline(graph)
        return {"ok": True}
    except PipelineValidationError as e:
        raise HTTPException(
            status_code=400, 
            detail={"message": str(e), "details": e.details}
        )
