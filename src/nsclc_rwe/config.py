import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    database_url: str
    atlas_base_url: str
    atlas_source_key: str
    model: str = "claude-opus-4-8"


def load_settings() -> Settings:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env and fill it in."
        )
    return Settings(
        database_url=database_url,
        atlas_base_url=os.environ.get(
            "ATLAS_BASE_URL", "https://atlas-demo.ohdsi.org/WebAPI"
        ),
        atlas_source_key=os.environ.get("ATLAS_SOURCE_KEY", "SYNPUF1K"),
    )
