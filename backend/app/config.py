from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv(
        "APP_NAME",
        "College Survival Dashboard API",
    )
    environment: str = os.getenv("APP_ENV", "local")


settings = Settings()
