import os

# Set dummy env vars before any app module imports Settings()
os.environ.setdefault("WORKERS_DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("MINIO_ACCESS_KEY", "test")
os.environ.setdefault("MINIO_SECRET_KEY", "test")
os.environ.setdefault("ADMIN_JWT_SECRET", "test-secret")
