"""
tailhub/app.py
FastAPI application factory — mounts all routes and serves the static frontend.
"""
from __future__ import annotations

import pathlib

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from tailhub.routes import files, status

STATIC_DIR = pathlib.Path(__file__).parent / "static"

app = FastAPI(title="TailHub", version="0.1.0", docs_url="/api/docs")

# API routes
app.include_router(status.router)
app.include_router(files.router)

# Serve the frontend — this must come LAST so API routes take precedence
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
