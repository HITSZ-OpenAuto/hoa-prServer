from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    org_name: str
    github_token: str | None

    api_key: str | None

    db_path: Path
    poll_interval_seconds: int

    smtp_host: str | None
    smtp_port: int
    smtp_user: str | None
    smtp_password: str | None
    smtp_from: str | None
    admin_email: str | None


def load_settings() -> Settings:
    org_name = os.getenv("ORG_NAME", "HITSZ-OpenAuto")
    github_token = os.getenv("GITHUB_TOKEN")

    api_key = os.getenv("API_KEY")

    db_path = Path(os.getenv("HOA_PRSERVER_DB", "./data/hoa_prserver.sqlite3"))
    poll_interval_seconds = int(os.getenv("POLL_INTERVAL_SECONDS", "3600"))

    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM")
    admin_email = os.getenv("ADMIN_EMAIL")

    return Settings(
        org_name=org_name,
        github_token=github_token,
        api_key=api_key,
        db_path=db_path,
        poll_interval_seconds=poll_interval_seconds,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        smtp_from=smtp_from,
        admin_email=admin_email,
    )
