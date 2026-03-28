import json

from minio import Minio

from app.config import settings

minio_client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=settings.minio_secure,
)

# bucket → list of public key prefixes (e.g. "raw/*")
_BUCKETS: list[tuple[str, list[str]]] = [
    (settings.minio_bucket_panoramas, ["raw/*", "maps/panoramas/*"]),
    (settings.minio_bucket_floors, ["maps/*"]),
    (settings.minio_bucket_avatars, ["avatars/*"]),
]


def ensure_buckets() -> None:
    """Create buckets with public-read policy if they don't exist."""
    for bucket, prefixes in _BUCKETS:
        if not minio_client.bucket_exists(bucket):
            minio_client.make_bucket(bucket)
            policy = json.dumps(
                {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"AWS": ["*"]},
                            "Action": ["s3:GetObject"],
                            "Resource": [f"arn:aws:s3:::{bucket}/{p}" for p in prefixes],
                        }
                    ],
                }
            )
            minio_client.set_bucket_policy(bucket, policy)
