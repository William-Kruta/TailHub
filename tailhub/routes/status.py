"""
tailhub/routes/status.py
GET /api/status — returns the current node info and peer list.
"""
from __future__ import annotations

import io
import qrcode
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from tailhub import tailscale

router = APIRouter()

class ToggleRequest(BaseModel):
    up: bool


@router.get("/api/status")
async def api_status():
    try:
        status = await tailscale.get_status()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {
        "self": {
            "dns_name": status.self_node.dns_name,
            "display_name": status.self_node.dns_name.split(".")[0] or status.self_node.hostname,
            "tailscale_ip": status.self_node.tailscale_ip,
            "os": status.self_node.os,
            "hostname": status.self_node.hostname,
            "backend_state": status.self_node.backend_state,
        },
        "peers": [
            {
                "dns_name": p.dns_name,
                "display_name": p.display_name,
                "tailscale_ip": p.tailscale_ip,
                "os": p.os,
                "online": p.online,
                "last_seen": p.last_seen,
                "hostname": p.hostname,
            }
            for p in status.peers
        ],
    }


@router.post("/api/status/toggle")
async def api_status_toggle(req: ToggleRequest):
    try:
        await tailscale.toggle_state(req.up)
        return {"status": "ok"}
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/api/ping/{target}")
async def api_ping(target: str):
    return await tailscale.ping(target)


@router.get("/api/status/qr")
async def api_status_qr():
    """Generate a QR code for the node's Tailscale URL."""
    try:
        status = await tailscale.get_status()
        ip = status.self_node.tailscale_ip
        if not ip:
             raise HTTPException(status_code=400, detail="Tailscale IP not available")
        
        # Construct the URL (we assume current PORT)
        from tailhub.config import PORT
        url = f"http://{ip}:{PORT}"
        
        # Generate QR code in memory
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(url)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
