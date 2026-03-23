from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    workers_database_url: str
    valkey_url: str = "redis://localhost:6379"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "gssr"
    minio_secure: bool = False

    nsfw_model_path: str = "models/nsfw.onnx"
    nsfw_threshold: float = 0.7

    admin_jwt_secret: str
    cors_origins: str = "http://localhost:5174"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
