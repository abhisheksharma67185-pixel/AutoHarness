from pydantic import BaseModel, Field, validator

class FailureLabelLLM(BaseModel):
    diagnosis_text: str = Field(..., min_length=5, max_length=400)
    taxonomy_primary: str
    severity: str
    confidence: str

    @validator("taxonomy_primary")
    def validate_taxonomy(cls, v):
        allowed = {"gap", "ambiguity", "tool_misuse", "code_bug", "upstream", "safety", "other"}
        if v not in allowed:
            raise ValueError("invalid taxonomy_primary")
        return v

    @validator("severity")
    def validate_severity(cls, v):
        if v not in {"low", "medium", "high", "critical"}:
            raise ValueError("invalid severity")
        return v

    @validator("confidence")
    def validate_confidence(cls, v):
        if v not in {"low", "medium", "high"}:
            raise ValueError("invalid confidence")
        return v
