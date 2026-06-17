from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette import status

from app.db.session import SessionLocal

router = APIRouter(prefix="/database", tags=["database"])

QueryType = Literal["SELECT", "INSERT", "UPDATE", "DELETE"]
QueryParams = dict[str, str | int | float | bool | None]


class DatabaseQueryRequest(BaseModel):
    query: str = Field(..., min_length=1)
    params: QueryParams = Field(default_factory=dict)
    query_type: QueryType | None = None
    table_name: str | None = None


class DatabaseQueryResponse(BaseModel):
    success: bool
    rows: list[dict[str, str | int | float | bool | None]]
    rows_affected: int


def _serialize_rows(result) -> list[dict[str, str | int | float | bool | None]]:
    if not result.returns_rows:
        return []

    rows: list[dict[str, str | int | float | bool | None]] = []
    for row in result.mappings().all():
        rows.append(jsonable_encoder(dict(row)))
    return rows


@router.post("/query", response_model=DatabaseQueryResponse)
def execute_query(payload: DatabaseQueryRequest):
    """
    Execute a parameterized SQL query using SQLAlchemy.
    """
    db: Session = SessionLocal()
    try:
        result = db.execute(text(payload.query), payload.params)
        rows = _serialize_rows(result)

        rows_affected = 0 if result.rowcount is None or result.rowcount < 0 else result.rowcount
        if not result.returns_rows:
            db.commit()

        return DatabaseQueryResponse(
            success=True,
            rows=rows,
            rows_affected=rows_affected,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query failed: {exc}",
        ) from exc
    finally:
        db.close()
