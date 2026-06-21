from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.settings import get_settings

settings = get_settings()

# Sanitize DATABASE_URL for sync SQLAlchemy usage (asyncpg is async-only)
db_url = str(settings.database_url)
if db_url.startswith("postgresql+asyncpg"):
    db_url = db_url.replace("postgresql+asyncpg", "postgresql")

engine = create_engine(
    db_url,
    future=True,
    pool_pre_ping=True,
    pool_recycle=300
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
