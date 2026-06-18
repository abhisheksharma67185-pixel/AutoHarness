from functools import lru_cache
from typing import Optional
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).parent.parent.parent.resolve()
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    app_name: str = "AutoHarness Studio API"
    api_v1_prefix: str = "/api/v1"
    environment: str = "development"

    database_url: str = f"sqlite+aiosqlite:///{BACKEND_DIR}/dev.db"

    llm_profile: str = "local_llama_cpp"
    llm_base_url: str = "http://localhost:8080/v1"
    llm_api_key: str = "dummy"
    llm_model: str = "local-llama-8b"

    harbor_bin: str = "harbor"
    harbor_jobs_dir: str = "./harbor_jobs"
    tb_dataset: str = "terminal-bench@2.0"

    docker_host: Optional[str] = None

    supabase_url: Optional[str] = None
    supabase_anon_key: Optional[str] = None
    supabase_service_role_key: Optional[str] = None

    model_config = SettingsConfigDict(

        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


def _to_async_postgres_url(url: str) -> str:
    """Convert a sync Postgres URL to async (aiosqlite-compatible) form."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@lru_cache
def get_settings() -> Settings:
    import os
    import shutil

    settings = Settings()

    # Pydantic already loaded DATABASE_URL from .env or env var into settings.database_url.
    # If it's a Postgres URL, ensure we use the async driver.
    if settings.database_url.startswith("postgres"):
        settings.database_url = _to_async_postgres_url(settings.database_url)
        print(f"Using PostgreSQL: {settings.database_url}")

    elif os.environ.get("VERCEL"):
        src_db = f"{BACKEND_DIR}/dev.db"
        dst_db = "/tmp/dev.db"
        if os.path.exists(src_db) and not os.path.exists(dst_db):
            try:
                shutil.copy2(src_db, dst_db)
                print(f"Copied DB to {dst_db}")
            except Exception as e:
                print(f"Failed to copy DB: {e}")
        settings.database_url = f"sqlite+aiosqlite:///{dst_db}"

    return settings

settings = get_settings()

