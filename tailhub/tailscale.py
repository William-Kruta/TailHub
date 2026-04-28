"""
tailhub/tailscale.py
Async wrapper around the `tailscale` CLI binary.
All subprocess calls use argument lists (no shell=True) to prevent injection.
"""
from __future__ import annotations

import asyncio
import json
import pathlib
import tempfile
import re
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Peer:
    dns_name: str
    tailscale_ip: str
    os: str
    online: bool
    last_seen: str
    hostname: str

    @property
    def display_name(self) -> str:
        """Short friendly name (strip the trailing tailnet domain)."""
        return self.dns_name.split(".")[0] if self.dns_name else self.hostname


@dataclass
class SelfNode:
    dns_name: str
    tailscale_ip: str
    os: str
    hostname: str
    backend_state: str  # e.g., "Running", "Stopped", "NeedsLogin"


@dataclass
class TailscaleStatus:
    self_node: SelfNode
    peers: list[Peer] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _run(*args: str) -> tuple[str, str, int]:
    """Run a command and return (stdout, stderr, returncode)."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return stdout.decode(), stderr.decode(), proc.returncode


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_status() -> TailscaleStatus:
    """Parse `tailscale status --json` into a TailscaleStatus object."""
    stdout, stderr, code = await _run("tailscale", "status", "--json")

    if code != 0:
        raise RuntimeError(f"tailscale status failed: {stderr.strip()}")

    data: dict[str, Any] = json.loads(stdout)

    me = data.get("Self", {})
    self_node = SelfNode(
        dns_name=me.get("DNSName", ""),
        tailscale_ip=me.get("TailscaleIPs", [""])[0] if me.get("TailscaleIPs") else "",
        os=me.get("OS", "unknown"),
        hostname=me.get("HostName", ""),
        backend_state=data.get("BackendState", "Unknown"),
    )

    peers: list[Peer] = []
    for peer_data in (data.get("Peer") or {}).values():
        peers.append(
            Peer(
                dns_name=peer_data.get("DNSName", ""),
                tailscale_ip=peer_data.get("TailscaleIPs", [""])[0],
                os=peer_data.get("OS", "unknown"),
                online=peer_data.get("Online", False),
                last_seen=peer_data.get("LastSeen", ""),
                hostname=peer_data.get("HostName", ""),
            )
        )

    # Sort: online peers first, then alphabetically
    peers.sort(key=lambda p: (not p.online, p.display_name.lower()))

    return TailscaleStatus(self_node=self_node, peers=peers)


async def send_file(filepath: pathlib.Path, target: str) -> None:
    """
    Send a file to a Tailscale peer using `tailscale file cp`.
    `target` is the peer's hostname or DNS name (without colon).
    """
    # Trailing colon is required by tailscale file cp
    stdout, stderr, code = await _run(
        "tailscale", "file", "cp", str(filepath), f"{target}:"
    )
    if code != 0:
        raise RuntimeError(f"tailscale file cp failed: {stderr.strip()}")


async def get_pending_files(download_dir: pathlib.Path) -> list[str]:
    """
    Check for pending incoming files without blocking (`--wait=false`).
    Moves files to `download_dir` and returns the list of filenames received.
    """
    download_dir.mkdir(parents=True, exist_ok=True)
    stdout, stderr, code = await _run(
        "tailscale", "file", "get", "--wait=false", str(download_dir)
    )
    # tailscale file get returns 0 even when there are no files.
    # stderr contains the list of filenames when files are received.
    if code != 0 and "no files" not in stderr.lower():
        raise RuntimeError(f"tailscale file get failed: {stderr.strip()}")

    # Collect what actually landed in the directory after the call
    received = [f.name for f in download_dir.iterdir() if f.is_file()]
    return sorted(received)


async def receive_files(download_dir: pathlib.Path) -> list[str]:
    """
    Pull all pending incoming files into `download_dir`.
    Returns list of filenames that were moved there.
    """
    return await get_pending_files(download_dir)


async def toggle_state(up: bool) -> None:
    """Run `tailscale up` or `tailscale down`."""
    cmd = "up" if up else "down"
    stdout, stderr, code = await _run("tailscale", cmd)
    if code != 0:
        raise RuntimeError(f"tailscale {cmd} failed: {stderr.strip()}")


async def ping(target: str) -> dict[str, Any]:
    """Run `tailscale ping -c 1 <target>` to get latency and transport type."""
    # Timeout after 5s if ping hangs
    try:
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "ping", "-c", "1", f"{target}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=4.0)
        stdout = stdout_bytes.decode()
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {"target": target, "latency": "timeout", "relay": False, "error": "timeout"}

    if proc.returncode != 0:
        return {"target": target, "latency": "error", "relay": False, "error": "failed"}

    out = stdout.lower()
    latency = "?"
    relay = "via derp" in out

    match = re.search(r"in\s+([\d\.]+ms)", out)
    if match:
        latency = match.group(1)

    return {"target": target, "latency": latency, "relay": relay, "error": None}
