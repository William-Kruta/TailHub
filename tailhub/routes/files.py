"""
tailhub/routes/files.py
File transfer routes:
  POST /api/files/send     — upload a file and ship it to a peer via Taildrop
  GET  /api/files/pending  — list files waiting in the download directory
  POST /api/files/receive  — pull pending Taildrop files into the download dir
"""
from __future__ import annotations

import pathlib
import time
import tempfile
import zipfile
import aiofiles
from fastapi import APIRouter, Form, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from tailhub import tailscale
from tailhub.config import DOWNLOAD_DIR

router = APIRouter()

# Max upload size: 2 GB (enforced at the route level via a simple check)
MAX_UPLOAD_BYTES = 2 * 1024 ** 3


def _safe_filename(name: str) -> str:
    """Strip path components to prevent directory traversal."""
    return pathlib.Path(name).name


def _safe_relative_path(name: str) -> pathlib.PurePosixPath:
    """Keep safe relative path components for folder uploads."""
    parts = []
    for part in pathlib.PurePosixPath(name.replace("\\", "/")).parts:
        if part in ("", ".", ".."):
            continue
        parts.append(part)
    if not parts:
        return pathlib.PurePosixPath("upload")
    return pathlib.PurePosixPath(*parts)


@router.post("/api/files/send")
async def api_send_file(
    files: list[UploadFile] = File(...),
    target: str = Form(...),
    relative_paths: list[str] | None = Form(None),
    archive_name: str | None = Form(None),
):
    """
    Receive single or multiple files from the web UI.
    If multiple, automatically create a zip archive.
    Then transfer the target file via Taildrop and return.
    """
    start = time.time()

    with tempfile.TemporaryDirectory() as td:
        temp_dir = pathlib.Path(td)
        
        if len(files) == 1:
            # Single file directly piped to temp file
            file = files[0]
            safe_name = _safe_filename(file.filename or "upload")
            final_path = temp_dir / safe_name
            async with aiofiles.open(final_path, "wb") as out_f:
                total = 0
                while content := await file.read(1024 * 1024):  # 1MB chunks
                    total += len(content)
                    if total > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="Upload exceeds 2 GB limit")
                    await out_f.write(content)
        else:
            # Multiple files or dropped folders -> auto-zip into an archive.
            zip_stem = _safe_filename(archive_name or f"TailHub_Archive_{time.strftime('%Y%m%d_%H%M%S')}")
            if zip_stem.lower().endswith(".zip"):
                zip_stem = zip_stem[:-4]
            final_path = temp_dir / f"{zip_stem}.zip"

            with zipfile.ZipFile(final_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for index, f in enumerate(files):
                    submitted_name = (
                        relative_paths[index]
                        if relative_paths and index < len(relative_paths)
                        else f.filename
                    )
                    archive_path = _safe_relative_path(submitted_name or f.filename or "upload")
                    out_path = temp_dir / f"upload-{index}"
                    async with aiofiles.open(out_path, "wb") as out_f:
                        total = 0
                        while content := await f.read(1024 * 1024):
                            total += len(content)
                            if total > MAX_UPLOAD_BYTES:
                                raise HTTPException(status_code=413, detail="Upload exceeds 2 GB limit")
                            await out_f.write(content)
                    zf.write(out_path, archive_path.as_posix())

        # Call tailscale.send_file which shells out to `tailscale file cp`
        try:
            await tailscale.send_file(final_path, target)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    elapsedMs = int((time.time() - start) * 1000)
    return {"status": "sent", "elapsedMs": elapsedMs, "target": target}


@router.get("/api/files/pending")
async def api_pending_files():
    """List files already downloaded to the local download directory."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(
        {"name": f.name, "size": f.stat().st_size, "modified": f.stat().st_mtime}
        for f in DOWNLOAD_DIR.iterdir()
        if f.is_file()
    )
    return {"download_dir": str(DOWNLOAD_DIR), "files": files}


@router.post("/api/files/receive")
async def api_receive_files():
    """Pull pending Taildrop transfers into the download directory."""
    try:
        received = await tailscale.receive_files(DOWNLOAD_DIR)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"status": "ok", "received": received, "download_dir": str(DOWNLOAD_DIR)}


@router.get("/api/files/download/{filename}")
async def api_download_file(filename: str):
    """Serve a file directly from the download directory."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(filename)
    path = DOWNLOAD_DIR / safe_name
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path)


@router.delete("/api/files/{filename}")
async def api_delete_file(filename: str):
    """Delete a file from the download directory."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(filename)
    path = DOWNLOAD_DIR / safe_name
    if not path.is_file():
        raise HTTPException(404, "File not found")
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete file: {exc}")
    return {"status": "deleted", "filename": safe_name}
