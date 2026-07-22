import pytest

from nsclc_rwe.config import load_settings


def test_load_settings_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError):
        load_settings()


def test_load_settings_reads_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h:5432/d")
    settings = load_settings()
    assert settings.database_url == "postgresql://u:p@h:5432/d"
    assert settings.atlas_base_url == "https://atlas-demo.ohdsi.org/WebAPI"
