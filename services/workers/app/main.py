import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from app.api import admin_maps, admin_panos, admin_users, health

app = FastAPI(title="GSSR Workers", version="1.0.0")

origins = os.getenv("ADMIN_CORS_ORIGINS", "http://localhost:5174").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app)

app.include_router(health.router)
app.include_router(admin_maps.router, prefix="/admin")
app.include_router(admin_panos.router, prefix="/admin")
app.include_router(admin_users.router, prefix="/admin")
