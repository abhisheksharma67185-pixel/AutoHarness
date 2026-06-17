from __future__ import annotations

from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from starlette import status

router = APIRouter(prefix="/http", tags=["http"])

HttpMethod = Literal["GET", "POST", "PUT", "DELETE"]
JsonPrimitive = str | int | float | bool | None
JsonValue = JsonPrimitive | list[Any] | dict[str, Any]


class HttpRequestPayload(BaseModel):
    url: str = Field(..., min_length=1)
    method: HttpMethod = "GET"
    headers: dict[str, str] = Field(default_factory=dict)
    body: JsonValue = None


class HttpRequestResponse(BaseModel):
    status: int
    body: JsonValue


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="HTTP node URL must be an absolute http:// or https:// URL.",
        )


def _parse_body(response: httpx.Response) -> JsonValue:
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return response.json()
    return response.text


@router.post("/request", response_model=HttpRequestResponse)
async def execute_http_request(payload: HttpRequestPayload):
    """
    Execute an outbound HTTP request through the backend.
    """
    _validate_url(payload.url)

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.request(
                method=payload.method,
                url=payload.url,
                headers=payload.headers,
                json=payload.body if payload.method in {"POST", "PUT"} else None,
            )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"HTTP request failed with status {exc.response.status_code}: {exc.response.text[:500]}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"HTTP request failed: {exc}",
        ) from exc

    return HttpRequestResponse(status=response.status_code, body=_parse_body(response))
