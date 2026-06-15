from contextlib import contextmanager
from typing import Generator
from fastapi import Depends
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.core.settings import get_settings, Settings

@contextmanager
def _get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_db() -> Generator[Session, None, None]:
    with _get_db() as db:
        yield db

def get_app_settings() -> Settings:
    return get_settings()
