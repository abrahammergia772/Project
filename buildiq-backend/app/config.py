"""
BuildIQ — config.py
Runtime configuration. Everything is environment-driven; see .env.example.
"""
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    APP_NAME: str = "BuildIQ API"
    APP_VERSION: str = "1.0.0"
    ENV: str = "development"          # development | staging | production

    # --- Security ---
    # MUST be overridden in production. Startup refuses to boot with the
    # default value when ENV=production (see main.py).
    SECRET_KEY: str = "dev-only-insecure-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24        # 24h — matches the frontend
    RESET_TOKEN_EXPIRE_MINUTES: int = 30

    # --- Supabase Postgres ---
    # Supabase → Project Settings → Database → Connection string (URI).
    # Use the pooled (pgbouncer, port 6543) URI for serverless deployments.
    # Example:
    #   postgresql+psycopg://postgres.<ref>:<pw>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
    DATABASE_URL: str = "sqlite:///./buildiq.db"
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_ECHO: bool = False

    # --- Supabase Storage (document uploads) ---
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""     # service_role key — server-side only, never expose
    SUPABASE_BUCKET: str = "buildiq-documents"
    # Falls back to local disk when Supabase Storage isn't configured.
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_MB: int = 25

    # --- Groq (AI) ---
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_TIMEOUT_SECONDS: float = 20.0
    GROQ_MAX_TOKENS: int = 700
    GROQ_TEMPERATURE: float = 0.4
    # When Groq is unavailable the deterministic heuristics are used instead.
    AI_ENABLED: bool = True

    # --- CORS ---
    CORS_ORIGINS: str = "*"

    # --- Seeding ---
    SEED_ON_STARTUP: bool = True
    SEED_DEMO_PASSWORD: str = "Demo1234!"

    @property
    def cors_origin_list(self) -> List[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENV.lower() == "production"

    @property
    def groq_ready(self) -> bool:
        return bool(self.AI_ENABLED and self.GROQ_API_KEY)

    @property
    def storage_ready(self) -> bool:
        return bool(self.SUPABASE_URL and self.SUPABASE_SERVICE_KEY)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
