from celery import Celery

from app.config import settings

celery_app = Celery(
    "gssr_workers",
    broker=settings.rabbitmq_url,
    backend=settings.valkey_url,
    include=[
        "app.tasks.tiling",
        "app.tasks.moderation",
        "app.tasks.elo",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)
