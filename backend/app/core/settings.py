from functools import lru_cache
from typing import Optional
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get absolute path of backend directory dynamically
BACKEND_DIR = Path(__file__).parent.parent.parent.resolve()

class Settings(BaseSettings):
    # Core
    app_name: str = "AutoHarness Studio API"
    api_v1_prefix: str = "/api/v1"
    environment: str = "development"

    # DB
    database_url: str = f"sqlite+aiosqlite:///{BACKEND_DIR}/dev.db"

    # LLM
    llm_profile: str = "local_llama_cpp"
    llm_base_url: str = "http://localhost:8080/v1"
    llm_api_key: str = "dummy"
    llm_model: str = "local-llama-8b"

    # Harbor / Terminal-Bench
    harbor_bin: str = "harbor"
    harbor_jobs_dir: str = "./harbor_jobs"
    tb_dataset: str = "terminal-bench@2.0"

    # Docker / Environment Overrides
    docker_host: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()

