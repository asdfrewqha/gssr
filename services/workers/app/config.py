from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    workers_database_url: str
    valkey_url: str = "redis://localhost:6379"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_panoramas: str = "gssr-panoramas"
    minio_bucket_floors: str = "gssr-floors"
    minio_bucket_avatars: str = "gssr-avatars"
    minio_secure: bool = False
    # Public-facing MinIO URL (used in presigned upload URLs returned to browser)
    minio_public_url: str = "http://localhost:9000"

    nsfw_model_path: str = "models/nsfw.onnx"
    nsfw_threshold: float = 0.7

    admin_jwt_secret: str
    cors_origins: str = "http://localhost:5174"

    # SMTP for email verification (empty = disabled)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@gssr.school"
    frontend_url: str = "http://localhost:5173"
    game_api_url: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
