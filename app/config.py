from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    environment: Literal["local", "test", "production"] = "local"
    log_level: str = "INFO"
    jwt_secret_key: str | None = Field(default=None, min_length=32)
    ai_extraction_enabled: bool = False
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-5-nano"
    openai_image_detail: Literal["low", "high", "auto"] = "high"
    openai_max_output_tokens: int = Field(default=400, ge=100, le=1000)
    openai_max_requests: int = Field(default=14, ge=1, le=1000)

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
