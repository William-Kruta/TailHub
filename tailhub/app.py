"""
tailhub/app.py
FastAPI application factory — mounts all routes and serves the static frontend.
"""
from __future__ import annotations

import pathlib
import secrets

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from tailhub import config
from tailhub.routes import files, status

STATIC_DIR = pathlib.Path(__file__).parent / "static"

app = FastAPI(title="TailHub", version="0.1.0", docs_url="/api/docs")


@app.middleware("http")
async def require_token(request: Request, call_next):
    """If TAILHUB_TOKEN is set, require it on every /api/* request."""
    if config.TOKEN and request.url.path.startswith("/api/"):
        supplied = (
            request.headers.get("X-TailHub-Token")
            or request.query_params.get("token")
            or ""
        )
        if not secrets.compare_digest(supplied, config.TOKEN):
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing token"})
    return await call_next(request)


# API routes
app.include_router(status.router)
app.include_router(files.router)

# Serve the frontend — this must come LAST so API routes take precedence
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
