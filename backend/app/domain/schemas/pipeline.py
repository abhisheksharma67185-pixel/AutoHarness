from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from datetime import datetime


class PipelineNode(BaseModel):
    id: str = Field(..., description="Unique node identifier")
    type: str = Field(..., description="Node type (input, output, llm, text, logic)")
    position: Dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})
    data: Dict[str, Any] = Field(default_factory=dict)
    selected: bool = Field(default=False)
    dimensions: Optional[Dict[str, float]] = Field(default=None)


class PipelineEdge(BaseModel):
    id: str = Field(..., description="Unique edge identifier")
    source: str = Field(..., description="Source node ID")
    target: str = Field(..., description="Target node ID")
    sourceHandle: Optional[str] = Field(default=None)
    targetHandle: Optional[str] = Field(default=None)
    type: str = Field(default="smoothstep")
    selected: bool = Field(default=False)
    markerEnd: Optional[Dict[str, Any]] = Field(default=None)


class PipelineGraph(BaseModel):
    nodes: List[PipelineNode] = Field(default_factory=list)
    edges: List[PipelineEdge] = Field(default_factory=list)


class PipelineValidationError(Exception):
    """Custom exception for pipeline validation errors"""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.details = details or {}


class CycleDetectionError(PipelineValidationError):
    """Exception raised when a cycle is detected in the pipeline graph"""

    def __init__(self, cycle_path: List[str]):
        super().__init__(
            "Pipeline contains a cycle",
            {"cycle_path": cycle_path}
        )
        self.cycle_path = cycle_path


class ValidationError(PipelineValidationError):
    """Exception raised for general validation errors"""

    pass
